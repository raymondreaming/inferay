use super::*;
use crate::backend::RUNTIME;
use crate::task::testing::{run_until, serial};
use rune::{Cx, Env, Runtime};

fn view(s: &Workspace, _: &mut Cx<Workspace>) -> El {
    crate::zoom::apply(s.zoom);
    col()
        .w_full()
        .h_full()
        .instant_changes()
        .child(s.transcript(0))
}

fn backend(profile: &std::path::Path) -> Arc<crate::backend::Backend> {
    RUNTIME
        .block_on(crate::backend::Backend::connect(profile.to_owned()))
        .unwrap()
}

fn workspace(backend: &Arc<crate::backend::Backend>) -> Workspace {
    let mut state = Workspace::empty();
    state.status.clear();
    state.conversations[0].loaded = true;
    state.backend = Arc::new(tokio::sync::OnceCell::new_with(Some(backend.clone())));
    state
}

fn publish(state: &mut Workspace, id: &str, render: inferay_core::chat_protocol::NativeChatRender) {
    let mut message: inferay_core::chat_protocol::ChatTranscriptMessage =
        serde_json::from_value(serde_json::json!({"id":id,"role":"system","content":""})).unwrap();
    message.render = Some(render);
    state.conversations[0].transcript.publish(
        PreparedTranscript::prepare(0, [Arc::new(message)], "vscode-black"),
        None,
    );
}

fn click(rt: &mut Runtime<Workspace>, key: &str) {
    for _ in 0..3 {
        rt.frame(1. / 60.);
    }
    let (x, y) = rt.find(key).unwrap_or_else(|| panic!("no element {key}"));
    rt.pointer_down(x, y);
    rt.pointer_up(x, y);
    rt.frame(1. / 60.);
}

#[test]
fn skill_cards_save_reject_and_restore_receipts() {
    let _serial = serial();
    let profile = tempfile::tempdir().unwrap();
    let backend = backend(profile.path());
    let proposal = serde_json::json!({"type":"inferay.skill-proposal","action":"create","name":"Card test","command":"card-test","description":"Test card","promptTemplate":"Run the requested checks.","reason":"Save reusable instructions"});
    let mut state = workspace(&backend);
    let mut render = inferay_core::chat_protocol::NativeChatRender::default();
    render.skill_proposal = Some(Box::new(
        serde_json::from_str(Box::leak(proposal.to_string().into_boxed_str())).unwrap(),
    ));
    publish(&mut state, "skill-test", render);
    let mut rt = Runtime::new(state, view, (1200., 1200.), Env::new(false, 1.));
    click(&mut rt, "review-skill-skill-test");
    run_until(&mut rt, |s| s.skill_proposals["skill-test"].task.is_none());
    assert_eq!(
        rt.state.skill_proposals["skill-test"].view["decided"],
        false
    );
    let skills = RUNTIME
        .block_on(backend.request(reqwest::Method::GET, "/api/prompts", None))
        .unwrap();
    assert!(
        !skills
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["command"] == "card-test")
    );
    click(&mut rt, "approve-skill-skill-test");
    run_until(&mut rt, |s| s.skill_proposals["skill-test"].task.is_none());
    assert!(
        rt.state.skill_proposals["skill-test"].view["savedSkillId"].is_string(),
        "{:?}",
        rt.state.skill_proposals["skill-test"].error
    );
    let skills = RUNTIME
        .block_on(backend.request(reqwest::Method::GET, "/api/prompts", None))
        .unwrap();
    let saved = skills
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["command"] == "card-test")
        .unwrap()
        .clone();
    assert_eq!(saved["promptTemplate"], proposal["promptTemplate"]);
    let action = |rt: &mut Runtime<Workspace>, id: &str, proposal: &serde_json::Value, decision| {
        let (id, proposal) = (id.to_owned(), proposal.clone());
        let done = id.clone();
        rt.update(move |s, _| s.skill_proposal_action(id, proposal, decision));
        run_until(rt, move |s| {
            s.skill_proposals
                .get(&done)
                .is_some_and(|state| state.task.is_none())
        });
    };
    rt.update(|s, _| s.skill_proposals.clear());
    action(&mut rt, "skill-test", &proposal, None);
    assert_eq!(
        rt.state.skill_proposals["skill-test"].view["savedSkillId"],
        saved["_id"]
    );
    let mut update = proposal.clone();
    update["action"] = serde_json::json!("update");
    update["skillId"] = saved["_id"].clone();
    update["expectedUpdatedAt"] = saved["updatedAt"].clone();
    update["promptTemplate"] = serde_json::json!("Updated instructions");
    action(&mut rt, "update", &update, None);
    action(&mut rt, "update", &update, Some("approve"));
    assert!(rt.state.skill_proposals["update"].view["savedSkillId"].is_string());
    action(&mut rt, "stale", &update, None);
    assert!(rt.state.skill_proposals["stale"].view["blockedReason"].is_string());
    action(&mut rt, "stale", &update, Some("reject"));
    assert_eq!(rt.state.skill_proposals["stale"].view["decided"], true);
}

#[test]
fn automation_proposal_requires_review_and_user_save_and_restores_receipt() {
    let _serial = serial();
    let profile = tempfile::tempdir().unwrap();
    let backend = backend(profile.path());
    let project = "00000000-0000-4000-8000-000000000001";
    RUNTIME.block_on(backend.request(reqwest::Method::POST, "/api/projects/command", Some(serde_json::json!({"type":"saveProject","expectedHash":null,"definition":{"schema":"inferay.project/1","id":project,"name":"Test","description":"","instructions":"","repositories":[]},"repositoryPaths":{}})))).unwrap();
    let command: ProjectFileCommand = serde_json::from_value(serde_json::json!({"type":"saveDefinition","projectId":project,"path":"automations/00000000-0000-4000-8000-000000000002/automation.json","expectedHash":null,"content":serde_json::json!({"schema":"inferay.automation/1","id":"00000000-0000-4000-8000-000000000002","name":"Test job","trigger":{"kind":"manual"},"overlap":"skip","may":[],"execution":{"kind":"agent","provider":"codex","instructions":"Test only","skills":[],"resources":[],"repositories":[],"workingDirectory":{"base":"project","path":"."},"timeoutSeconds":300}}).to_string()})).unwrap();
    let path = profile
        .path()
        .join("projects")
        .join(project)
        .join("automations/00000000-0000-4000-8000-000000000002/automation.json");
    let mut rt = Runtime::new(
        workspace(&backend),
        view,
        (1200., 1200.),
        Env::new(false, 1.),
    );
    let action = |rt: &mut Runtime<Workspace>, id: &str, decision| {
        let (id, command) = (id.to_owned(), command.clone());
        let done = id.clone();
        rt.update(move |s, _| s.automation_proposal_action(id, command, decision));
        run_until(rt, move |s| {
            s.proposals
                .get(&done)
                .is_none_or(|state| state.task.is_none())
        });
    };
    action(
        &mut rt,
        "proposal-test",
        Some(ProjectProposalDecision::Save),
    );
    assert!(!path.exists(), "Save must not run before review");
    action(&mut rt, "proposal-test", None);
    assert!(!path.exists(), "Review must not write");
    let mut render = inferay_core::chat_protocol::NativeChatRender::default();
    render.automation_definition_proposal = Some(Box::new(command.clone()));
    rt.update(move |s, _| publish(s, "proposal-test", render));
    let state = &rt.state.proposals["proposal-test"];
    assert!(state.task.is_none());
    assert!(
        state
            .view
            .as_ref()
            .is_some_and(|v| v.status == ProjectProposalStatus::Pending),
        "{:?}",
        state.error
    );
    click(&mut rt, "Save-proposal-proposal-test");
    run_until(&mut rt, |s| s.proposals["proposal-test"].task.is_none());
    assert!(path.exists());
    assert!(
        rt.state.proposals["proposal-test"]
            .view
            .as_ref()
            .is_some_and(|v| v.status == ProjectProposalStatus::Saved)
    );
    rt.update(|s, _| s.proposals.clear());
    action(&mut rt, "proposal-test", None);
    assert!(
        rt.state.proposals["proposal-test"]
            .view
            .as_ref()
            .is_some_and(|v| v.status == ProjectProposalStatus::Saved)
    );
    let saved = std::fs::read(&path).unwrap();
    action(&mut rt, "stale", None);
    action(&mut rt, "stale", Some(ProjectProposalDecision::Save));
    assert!(rt.state.proposals["stale"].error.is_some());
    assert_eq!(
        std::fs::read(&path).unwrap(),
        saved,
        "A stale proposal must not overwrite the saved definition"
    );
    action(&mut rt, "stale", Some(ProjectProposalDecision::Decline));
    assert!(
        rt.state.proposals["stale"]
            .view
            .as_ref()
            .is_some_and(|v| v.status == ProjectProposalStatus::Declined)
    );
    let state = RUNTIME
        .block_on(backend.request(
            reqwest::Method::GET,
            &format!("/api/projects?projectId={project}"),
            None,
        ))
        .unwrap();
    assert_eq!(state["catalog"]["automations"][0]["enabled"], false);
}
