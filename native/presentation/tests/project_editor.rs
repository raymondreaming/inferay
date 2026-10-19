use inferay_presentation::project;
use serde_json::json;

#[test]
fn proposal_paths_stay_inside_the_library_and_keep_the_manifest() {
    for path in ["../x", "/x", "a\\b", "a:b", "a/./b"] {
        assert!(
            project("proposalPath", &json!({"path":path})).is_err(),
            "{path}"
        );
    }
    assert!(
        project(
            "proposalPath",
            &json!({"path":"plugin.json","removal":true})
        )
        .is_err()
    );
}

#[test]
fn graph_layout_preserves_utf16_seeding_and_ignores_missing_endpoints() {
    let graph = json!({"nodes":[{"id":"a","kind":"note"},{"id":"😀","kind":"source"}],"edges":[{"from":"a","to":"😀"},{"from":"missing","to":"a"}]});
    let actual = project("memoryGraphLayout", &graph).unwrap();
    // Positions captured from the previous JS implementation, including a surrogate pair.
    for (i, x, y) in [
        (0, 90.04405706390918, -64.60870612357698),
        (1, -77.98772999929992, 50.85755218726185),
    ] {
        assert!((actual[i][1]["x"].as_f64().unwrap() - x).abs() < 1e-8);
        assert!((actual[i][1]["y"].as_f64().unwrap() - y).abs() < 1e-8);
    }
    assert_eq!(project("memoryGraphLayout", &graph).unwrap(), actual);
    assert_eq!(
        project("memoryGraphLayout", &json!({"nodes":[],"edges":[]})).unwrap(),
        json!([])
    );
}

#[test]
fn import_manifest_counts_directories_and_reserves_generated_metadata() {
    use inferay_core::project_files::{PLUGIN_BYTE_LIMIT, validate_import_manifest};
    assert!(validate_import_manifest([("a/b.txt", 12)]).is_ok());
    assert!(validate_import_manifest([("../b.txt", 12)]).is_err());
    assert!(validate_import_manifest([("b.txt", PLUGIN_BYTE_LIMIT)]).is_err());
    let names: Vec<_> = (0..499).map(|i| format!("{i}/file")).collect();
    assert!(validate_import_manifest(names.iter().map(|name| (name.as_str(), 0))).is_err());
}

#[test]
fn schedule_presets_preserve_calendar_details_and_interval_semantics() {
    for (seconds, trigger) in [
        (json!(null), json!({"kind":"manual"})),
        (json!(3600), json!({"kind":"interval","seconds":3600})),
        (
            json!(86400),
            json!({"kind":"calendar","timezone":"America/New_York","days":[1,2,3,4,5,6,7],"times":["09:00"]}),
        ),
        (
            json!(604800),
            json!({"kind":"calendar","timezone":"America/New_York","days":[1],"times":["09:00"]}),
        ),
        (json!(1234), json!({"kind":"interval","seconds":1234})),
    ] {
        let definition = project("newAutomation", &json!({"id":"draft","name":"Draft","instructions":"Run","model":"model","intervalSeconds":seconds,"timezone":"America/New_York"})).unwrap();
        assert_eq!(definition["trigger"], trigger);
    }
    let calendar = json!({"kind":"calendar","timezone":"America/New_York","days":[3,5],"times":["09:00","16:30"]});
    let daily = project(
        "triggerPreset",
        &json!({"trigger":calendar,"preset":"86400","timezone":"UTC"}),
    )
    .unwrap();
    assert_eq!(daily["timezone"], "America/New_York");
    assert_eq!(daily["times"], calendar["times"]);
    assert_eq!(daily["days"], json!([1, 2, 3, 4, 5, 6, 7]));
    let weekly = project(
        "triggerPreset",
        &json!({"trigger":calendar,"preset":"604800","timezone":"UTC"}),
    )
    .unwrap();
    assert_eq!(weekly["days"], json!([3]));
    assert_eq!(weekly["times"], calendar["times"]);
    let interval = json!({"kind":"interval","seconds":86400});
    assert_eq!(
        project(
            "triggerPreset",
            &json!({"trigger":interval,"preset":"custom","timezone":"UTC"})
        )
        .unwrap(),
        interval
    );
    assert!(
        project(
            "triggerPreset",
            &json!({"trigger":calendar,"preset":"invalid","timezone":"UTC"})
        )
        .is_err()
    );
}

#[test]
fn skill_selection_preserves_qualified_and_unavailable_references() {
    let input = json!({
        "global":[["global-id","Global skill"]], "ownerPath":"plugins/own",
        "selected":["plugin:own:same","missing","missing"],
        "local":[
            {"id":"same","label":"Own","source":"Own library","ownerPath":"plugins/own","qualifiedId":"plugin:own:same"},
            {"id":"same","label":"Other","source":"Other library","ownerPath":"plugins/other","qualifiedId":"plugin:other:same"},
            {"id":"private","label":"Private","source":"This automation","ownerPath":"automations/other","qualifiedId":null}
        ]
    });
    let choices = project("skillChoices", &input).unwrap();
    let ids: Vec<_> = choices
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["id"].as_str().unwrap())
        .collect();
    assert_eq!(
        ids,
        [
            "global:global-id",
            "plugin:own:same",
            "plugin:other:same",
            "missing"
        ]
    );
    assert_eq!(choices[3]["source"], "Unavailable skill");
    let mut unqualified = input;
    unqualified["selected"] = json!(["same"]);
    assert_eq!(
        project("skillChoices", &unqualified).unwrap()[1]["id"],
        "same"
    );
}

#[test]
fn editing_one_tool_grant_preserves_unavailable_and_other_library_grants() {
    let grant = json!({"pluginId":"own","toolId":"run","required":false});
    let other = json!({"pluginId":"other","toolId":"run","required":true});
    let missing = json!({"pluginId":"missing","toolId":"gone","required":true});
    for enabled in [false, true] {
        let result = project(
            "editToolGrant",
            &json!({"grants":[grant,other,grant,missing],"grant":grant,"enabled":enabled}),
        )
        .unwrap();
        assert_eq!(
            result,
            if enabled {
                json!([other, missing, {"pluginId":"own","toolId":"run"}])
            } else {
                json!([other, missing])
            }
        );
    }
}

#[test]
fn effect_controls_preserve_delivery_and_cancellation_states() {
    for (state, status, cancel) in [
        ("queued", "Queued · Not sent", Some("Cancel delivery")),
        (
            "in_flight",
            "In progress · Outcome pending",
            Some("Request stop"),
        ),
        (
            "uncertain",
            "Outcome unknown · Needs reconciliation",
            Some("Request stop"),
        ),
        ("delivered", "Delivered", None),
        ("cancelled", "Cancelled · Not sent", None),
    ] {
        for stopping in [false, true] {
            let view = project("effectPresentation", &json!({"dismissedAt":null,"delivery":{"id":"delivery","state":state,"cancellationRequestedAt":if stopping {Some(1)} else {None},"receipt":null}})).unwrap();
            assert_eq!(
                view["status"],
                if state == "uncertain" && stopping {
                    "Stop requested · Outcome unknown"
                } else {
                    status
                }
            );
            assert_eq!(view["cancel"], json!(if stopping { None } else { cancel }));
            assert_eq!(view["dismissible"], false);
        }
    }
    for dismissed in [None, Some(1)] {
        let view = project(
            "effectPresentation",
            &json!({"dismissedAt":dismissed,"delivery":null}),
        )
        .unwrap();
        assert_eq!(view["dismissible"], dismissed.is_none());
        assert_eq!(
            view["status"],
            if dismissed.is_some() {
                "Dismissed · Not sent"
            } else {
                "Pending review · Not sent"
            }
        );
        assert!(view["cancel"].is_null());
    }
}

#[test]
fn catalog_relationships_preserve_repair_visibility_scopes_and_archived_dependencies() {
    use inferay_core::project_files::ProjectFileCatalog;
    let file = |project: &str, path: &str, plugin: Option<&str>, definition: serde_json::Value| json!({"id":definition["id"],"projectId":project,"sourcePath":path,"pluginId":plugin,"sourceHash":"hash","error":null,"definition":definition});
    let library = json!({"schema":"inferay.plugin/1","id":"library","name":"Library","version":"1","description":"","may":[]});
    let automation = |project: &str, path: &str, id: &str, archived: bool| json!({"file":file(project,path,None,json!({"schema":"inferay.automation/1","id":id,"name":id,"archived":archived,"trigger":{"kind":"manual"},"overlap":"skip","execution":{"kind":"agent","provider":"codex","instructions":"Run","tools":[{"pluginId":"library","toolId":"tool"}],"skills":["plugin:library:skill"],"resources":[],"repositories":["repo"],"workingDirectory":{"base":"repository","id":"repo"},"timeoutSeconds":300},"may":[]})),"enabled":true,"nextDueAt":null,"inputsChanged":false,"executionError":null});
    let mut catalog: ProjectFileCatalog = serde_json::from_value(json!({
        "projects":[], "resources":[], "repositoryPaths":{},
        "plugins":[{"file":file("p","plugins/lib/plugin.json",None,library),"approvedHash":null,"approvedAt":null}],
        "tools":[file("p","plugins/lib/tools/run/tool.json",Some("library"),json!({"schema":"inferay.tool/1","id":"tool","name":"Tool","program":"python3","entrypoint":"run.py","args":[],"timeoutSeconds":30,"inputSchema":{},"outputSchema":{},"pack":{"repositoryId":"pack-repo","commit":"commit","sha256":"hash"}}))],
        "skills":[file("p","plugins/lib/skills/skill.json",Some("library"),json!({"id":"skill","name":"Skill","description":"","instructions":"Run"}))],
        "automations":[automation("p","plugins/lib/automations/own.json","own",false), automation("p","automations/external/automation.json","external",false), automation("p","automations/archived/automation.json","archived",true), automation("other","plugins/lib/automations/other.json","other-project",false)],
        "issues":[]
    })).unwrap();
    catalog.derive_relationships();
    let overview = &catalog.plugins[0].overview;
    assert_eq!(overview.status, "Schedules active");
    assert_eq!(
        overview
            .consumers
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["external", "own"]
    );
    assert_eq!(overview.tools, ["Tool"]);
    assert_eq!(catalog.repository_users["pack-repo"][0].name, "Tool");
    assert!(
        catalog.repository_users["repo"]
            .iter()
            .any(|u| u.automation_id.as_deref() == Some("archived"))
    );
    assert_eq!(
        catalog.skill_choices[0].qualified_id.as_deref(),
        Some("plugin:library:skill")
    );
    assert_eq!(catalog.tool_choices[0].label, "Library · Tool");
    let first = serde_json::to_value(&catalog).unwrap();
    catalog.derive_relationships();
    assert_eq!(
        serde_json::to_value(&catalog).unwrap(),
        first,
        "Refreshing must not duplicate derived relationships"
    );
    catalog.plugins[0].file.error = Some("Invalid manifest".into());
    catalog.plugins[0].file.definition = None;
    catalog.issues.push(serde_json::from_value(json!({"projectId":"p","sourcePath":"plugins/lib/plugin.json","error":"Invalid manifest"})).unwrap());
    catalog.derive_relationships();
    assert_eq!(catalog.plugins.len(), 1);
    assert_eq!(catalog.plugins[0].overview.status, "Needs repair");
    assert!(catalog.tool_choices.is_empty());
    assert!(catalog.skill_choices[0].qualified_id.is_none());
}
