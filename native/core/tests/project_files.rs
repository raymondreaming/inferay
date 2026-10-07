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
        validate_references(&a, Some(&p), &empty, &empty, &empty, &empty)
            .unwrap_err()
            .contains("may")
    );
    p.may = a.may.clone();
    assert!(
        validate_references(&a, Some(&p), &empty, &empty, &empty, &empty)
            .unwrap_err()
            .contains("unresolved skill")
    );
    let skills = BTreeSet::from([ID.into()]);
    let repos = BTreeSet::from([ID.into()]);
    assert!(validate_references(&a, Some(&p), &skills, &empty, &empty, &repos).is_ok());
    for (reference, valid) in [("daily", false), ("global:daily", true), ("global:", false)] {
        let mut candidate = a.clone();
        if let DefinitionExecution::Agent { skills, .. } = &mut candidate.execution {
            *skills = vec![reference.into()];
        }
        let inventory = BTreeSet::from([reference.into()]);
        assert_eq!(
            validate_references(&candidate, Some(&p), &inventory, &empty, &empty, &repos).is_ok(),
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

#[test]
fn repository_packs_require_stable_identity_and_full_hashes() {
    let value = json!({"schema":"inferay.tool/1","id":ID,"name":"Pinned tool","program":"python3","entrypoint":"scripts/run.py","args":[],"timeoutSeconds":30,"inputSchema":{},"outputSchema":{},"pack":{"repositoryId":ID,"commit":"a".repeat(40),"sha256":"b".repeat(64)}});
    assert!(parse::<ToolDefinition>("tools/report/tool.json", value.to_string().as_bytes()).is_ok());
    for (field, invalid) in [("repositoryId", "kit"), ("commit", "main"), ("commit", "abcdef"), ("sha256", "not-a-hash")] {
        let mut invalid_value = value.clone();
        invalid_value["pack"][field] = json!(invalid);
        assert!(parse::<ToolDefinition>("tools/report/tool.json", invalid_value.to_string().as_bytes()).is_err(), "{field}");
    }
}

#[test]
fn required_tool_grants_preserve_optional_defaults_and_reject_duplicate_identity() {
    let plugin = "11111111-1111-4111-8111-111111111111";
    let tool = "22222222-2222-4222-8222-222222222222";
    let optional = serde_json::json!({"pluginId":plugin,"toolId":tool});
    let grant: inferay_core::project_files::AgentToolGrant = serde_json::from_value(optional.clone()).unwrap();
    assert!(!grant.required);
    assert_eq!(serde_json::to_value(grant).unwrap(), optional);
    let mut automation = serde_json::json!({"schema":"inferay.automation/1","id":"33333333-3333-4333-8333-333333333333","name":"Required checks","trigger":{"kind":"manual"},"overlap":"skip","may":[],"execution":{"kind":"agent","provider":"codex","instructions":"Use the check","skills":[],"resources":[],"repositories":[],"workingDirectory":{"base":"project","path":"."},"timeoutSeconds":60,"tools":[{"pluginId":plugin,"toolId":tool,"required":true}]}});
    assert!(parse::<AutomationDefinition>("automations/check/automation.json", automation.to_string().as_bytes()).is_ok());
    automation["execution"]["tools"].as_array_mut().unwrap().push(optional);
    assert!(parse::<AutomationDefinition>("automations/check/automation.json", automation.to_string().as_bytes()).is_err());
}

#[test]
fn tool_connection_references_require_bounded_aliases_and_local_ids() {
    let mut value = json!({"schema":"inferay.tool/1","id":ID,"name":"Connected tool","program":"python3","entrypoint":"run.py","args":[],"timeoutSeconds":30,"inputSchema":{},"outputSchema":{},"connections":{"SERVICE":ID}});
    assert!(parse::<ToolDefinition>("tools/read/tool.json", value.to_string().as_bytes()).is_ok());
    for alias in ["", "lowercase", "0START", "WITH SPACE", "WITH=EQUALS"] {
        value["connections"] = json!({alias:ID});
        assert!(parse::<ToolDefinition>("tools/read/tool.json", value.to_string().as_bytes()).is_err());
    }
    value["connections"] = json!({"SERVICE":"secret-value"});
    assert!(parse::<ToolDefinition>("tools/read/tool.json", value.to_string().as_bytes()).is_err());
    value["connections"] = (0..17).map(|i| (format!("SERVICE_{i}"), json!(ID))).collect::<serde_json::Map<_,_>>().into();
    assert!(parse::<ToolDefinition>("tools/read/tool.json", value.to_string().as_bytes()).is_err());
}
