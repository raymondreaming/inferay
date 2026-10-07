use inferay_core::project_files::*;
use serde_json::json;
use std::collections::BTreeSet;
const ID: &str = "f4b102ea-1362-4ee7-bd20-3bfd07487311";
fn automation() -> serde_json::Value {
    json!({"schema":"inferay.automation/1","id":ID,"name":"Daily research","trigger":{"kind":"calendar","timezone":"America/Chicago","days":[1,2,3,4,5,6,7],"times":["06:00"]},"overlap":"skip","execution":{"kind":"agent","provider":"codex","model":null,"reasoningLevel":"high","instructions":"Run the research skill","skills":[ID],"resources":[],"repositories":[ID],"workingDirectory":{"base":"repository","id":ID},"timeoutSeconds":14400},"may":["read_repositories"]})
}
#[test]
fn portable_definitions_reject_unknown_fields_versions_and_absolute_paths() {
    let value = automation();
    assert!(
        parse::<AutomationDefinition>("automations/daily.json", value.to_string().as_bytes())
            .is_ok()
    );
    for value in [
        {
            let mut v = value.clone();
            v["enabled"] = json!(true);
            v
        },
        {
            let mut v = value.clone();
            v["schema"] = json!("inferay.automation/2");
            v
        },
        {
            let mut v = value.clone();
            v["execution"]["workingDirectory"] = json!({"base":"external","path":"/tmp/repo"});
            v
        },
        {
            let mut v = value.clone();
            v["execution"]["workingDirectory"] = json!({"base":"plugin","path":"../escape"});
            v
        },
        {
            let mut v = value.clone();
            v["may"] = json!(["publish"]);
            v
        },
    ] {
        let error =
            parse::<AutomationDefinition>("automations/daily.json", value.to_string().as_bytes())
                .unwrap_err();
        assert!(error.starts_with("automations/daily.json:"));
    }
    assert!(relative_path("/tmp/file").is_err());
    assert!(relative_path("C:\\file").is_err());
    assert!(relative_path("tools/../file").is_err());
    assert!(relative_path("tools/report.py").is_ok());
}
#[test]
fn references_and_permission_ceiling_are_checked_without_io() {
    let a: AutomationDefinition = parse("daily.json", automation().to_string().as_bytes()).unwrap();
    let mut p:PluginDefinition=parse("plugin.json",json!({"schema":"inferay.plugin/1","id":ID,"name":"Research","version":"0.1.0","description":"","may":[]}).to_string().as_bytes()).unwrap();
    let empty = BTreeSet::new();
    assert!(
        validate_references(&a, &p, &empty, &empty, &empty, &empty)
            .unwrap_err()
            .contains("may")
    );
    p.may = a.may.clone();
    assert!(
        validate_references(&a, &p, &empty, &empty, &empty, &empty)
            .unwrap_err()
            .contains("unresolved skill")
    );
    let skills = BTreeSet::from([ID.into()]);
    let repos = BTreeSet::from([ID.into()]);
    assert!(validate_references(&a, &p, &skills, &empty, &empty, &repos).is_ok());
    for (reference, valid) in [("daily", false), ("global:daily", true), ("global:", false)] {
        let mut candidate = a.clone();
        if let DefinitionExecution::Agent { skills, .. } = &mut candidate.execution {
            *skills = vec![reference.into()];
        }
        let inventory = BTreeSet::from([reference.into()]);
        assert_eq!(
            validate_references(&candidate, &p, &inventory, &empty, &empty, &repos).is_ok(),
            valid
        );
    }
}
#[test]
fn calendar_trigger_supports_multiple_times_and_dst() {
    let trigger = Trigger::Calendar {
        timezone: "America/Chicago".into(),
        days: (1..=7).collect(),
        times: vec!["09:00".into(), "15:30".into()],
    };
    let ms = |s: &str| {
        chrono::DateTime::parse_from_rfc3339(s)
            .unwrap()
            .timestamp_millis()
    };
    assert_eq!(
        trigger.next_after(ms("2026-03-07T21:30:00Z")).unwrap(),
        Some(ms("2026-03-08T14:00:00Z"))
    );
    assert_eq!(
        trigger.next_after(ms("2026-03-08T14:00:00Z")).unwrap(),
        Some(ms("2026-03-08T20:30:00Z"))
    );
}
#[test]
fn skill_front_matter_and_manifest_limits_are_validated() {
    let text = format!(
        "---\nid: {ID}\nname: Daily\ndescription: Research\ncommand: /daily\n---\nRead project sources."
    );
    assert_eq!(parse_skill("skills/daily.md", &text).unwrap().name, "Daily");
    assert!(
        parse_skill(
            "skills/daily.md",
            &text.replace("name: Daily", "name: Daily\nname: Other")
        )
        .is_err()
    );
    assert!(
        parse::<PluginDefinition>("plugin.json", &vec![b' '; MANIFEST_LIMIT + 1])
            .unwrap_err()
            .contains("131072")
    );
}
