//! Attach a completed automation's provider session and transcript to a project pane.
use super::*;
use inferay_core::{chat_protocol::ChatMessageBuffer, projects::ProjectCommand, workspace_action::AgentWorkspaceAction};
static IMPORT_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub(super) async fn open(state: &ServerState, request: Request) -> ApiResult {
    #[derive(Deserialize)]
    struct Input { id: String }
    let input: Input = api_body(request).await?;
    let _guard = IMPORT_LOCK.lock().await;
    let run = state.projects.run_for_chat(&input.id).map_err(|e| api_error(StatusCode::BAD_REQUEST,e))?;
    if ["running","queued"].contains(&run.status.as_str()) { return Err(api_error(StatusCode::BAD_REQUEST,"Wait for this run to finish before continuing it")); }
    let execution = &run.snapshot["execution"];
    if execution["kind"] != "agent" { return Err(api_error(StatusCode::BAD_REQUEST,"Only agent runs have a conversation")); }
    let provider = execution["provider"].as_str().unwrap_or("codex");
    let catalog = state.projects.catalog(Some(run.project_id.clone()),None).await.map_err(|e| api_error(StatusCode::BAD_REQUEST,e))?;
    let project = catalog.projects.iter().find(|p| p.id == run.project_id).ok_or_else(|| api_error(StatusCode::NOT_FOUND,"Project not found"))?;
    let cwd = if execution["workingDirectory"]["base"] == "external" { PathBuf::from(execution["workingDirectory"]["path"].as_str().unwrap_or(&project.directory)) } else { PathBuf::from(&project.directory).join(execution["workingDirectory"]["path"].as_str().unwrap_or(".")) };
    let log = tokio::fs::read_to_string(PathBuf::from(&run.directory).join("logs/agent.jsonl")).await.map_err(|e| api_error(StatusCode::BAD_REQUEST,e))?;
    let mut buffer = ChatMessageBuffer::default();
    buffer.push_user(execution["instructions"].as_str().unwrap_or("Automation run"),None);
    let mut session = None;
    for line in log.lines() {
        if let Ok(value) = serde_json::from_str::<Value>(line) {
            if let Some(id) = value["providerSessionId"].as_str() { session=Some(id.to_owned()); }
            else if let Some(text) = value["system"].as_str() { buffer.push_system(text); }
            else { buffer.apply_event(&value); }
        }
    }
    buffer.finalize();
    let prior_pane = run.result.as_ref().and_then(|v|v["chatPaneId"].as_str());
    let (pane_id, existing) = {
        let store = state.agent_state_store.lock().expect("agent state lock poisoned");
        let workspace = store.read().map_err(|e|api_error(StatusCode::BAD_REQUEST,e))?;
        let existing = workspace["groups"].as_array().into_iter().flatten().find_map(|g| g["panes"].as_array().into_iter().flatten().find(|p|prior_pane.is_some() && p["id"].as_str()==prior_pane).map(|p|(g["id"].as_str().unwrap().to_owned(),p["id"].as_str().unwrap().to_owned())));
        if let Some((group_id,pane_id)) = existing {
            store.apply_workspace_action(&AgentWorkspaceAction::SelectPane{group_id,pane_id:pane_id.clone()},provider).map_err(|e|api_error(StatusCode::BAD_REQUEST,e))?;
            (pane_id,true)
        } else {
            let value=store.apply_workspace_action(&AgentWorkspaceAction::AddPane{group_id:None,agent_kind:Some(if provider=="claude" {inferay_core::provider_config::WorkspaceAgentKind::Claude} else {inferay_core::provider_config::WorkspaceAgentKind::Codex}),cwd:Some(cwd.to_string_lossy().into()),reference_paths:None},provider).map_err(|e|api_error(StatusCode::BAD_REQUEST,e))?;
            let group=value["groups"].as_array().and_then(|gs|gs.iter().find(|g|g["id"]==value["selectedGroupId"])).ok_or_else(||api_error(StatusCode::BAD_REQUEST,"No selected group"))?;
            let pane=group["selectedPaneId"].as_str().ok_or_else(||api_error(StatusCode::BAD_REQUEST,"No selected pane"))?.to_owned();
            store.set_pane_summary(&pane,Some(run.name.clone())).map_err(|e|api_error(StatusCode::BAD_REQUEST,e))?;
            (pane,false)
        }
    };
    if !existing {
        if let Some(update)=buffer.take_update() { state.chat_persistence.persist_update(&pane_id,&update).await.map_err(|e|api_error(StatusCode::BAD_REQUEST,e))?; }
        if let Some(session)=session {
            state.chat_persistence.save_session_reference(&pane_id,provider,&session,&cwd,(execution["model"].as_str(),execution["reasoningLevel"].as_str())).await.map_err(|e|api_error(StatusCode::BAD_REQUEST,e))?;
        } else {
            state.chat_persistence.save_agent_context(&pane_id,format!("Continue this prior automation run using its captured instructions and results. Original provider session is unavailable.\n{}\n{}",execution,run.result.clone().unwrap_or(Value::Null))).await.map_err(|e|api_error(StatusCode::BAD_REQUEST,e))?;
        }
        state.projects.command(ProjectCommand::AssociateConversation{project_id:run.project_id,pane_id:pane_id.clone()},true).await.map_err(|e|api_error(StatusCode::BAD_REQUEST,e))?;
    }
    state.projects.attach_run_chat(&run.id,&pane_id).map_err(|e|api_error(StatusCode::BAD_REQUEST,e))?;
    Ok(json!({"paneId":pane_id}))
}
