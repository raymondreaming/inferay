use inferay_core::projects::ToolInterface;
use serde_json::json;

#[test]
fn cli_inputs_are_single_literal_arguments_with_bounded_scalar_values() {
    let args = [
        "{entrypoint}",
        "--title",
        "{input.title}",
        "{input.count}",
        "{input.enabled}",
    ]
    .map(String::from);
    let input = json!({"title":"two words; $(touch unwanted)","count":3,"enabled":false});
    assert_eq!(
        ToolInterface::Cli
            .arguments(&args, &input, "script.py")
            .unwrap()
            .iter()
            .map(|arg| arg.resolve("/output"))
            .collect::<Vec<_>>(),
        vec![
            "script.py",
            "--title",
            "two words; $(touch unwanted)",
            "3",
            "false"
        ]
    );
    for invalid in [
        json!({}),
        json!({"title":null}),
        json!({"title":[]}),
        json!({"title":{}}),
        json!({"title":"bad\u{0}value"}),
        json!({"title":"x".repeat(8001)}),
    ] {
        assert!(
            ToolInterface::Cli
                .arguments(
                    &["{entrypoint}".into(), "{input.title}".into()],
                    &invalid,
                    "script.py"
                )
                .is_err()
        );
    }
    for invalid in [
        "--title={input.title}",
        "{input.}",
        "{input.title",
        "{input.a.b}",
    ] {
        assert!(
            ToolInterface::Cli
                .validate_arguments(&["{entrypoint}".into(), invalid.into()])
                .is_err()
        );
    }
    // Existing JSON-stdin tools keep literal argument strings unchanged.
    assert_eq!(
        ToolInterface::JsonStdin
            .arguments(&args, &input, "script.py")
            .unwrap()
            .iter()
            .map(|arg| arg.resolve("/output"))
            .collect::<Vec<_>>(),
        std::iter::once("script.py".to_string())
            .chain(args)
            .collect::<Vec<_>>()
    );
}

#[test]
fn cli_entrypoint_can_follow_interpreter_flags_and_values_are_not_reexpanded() {
    let args = [
        "--background",
        "--python",
        "{entrypoint}",
        "--",
        "{input.caption}",
    ]
    .map(String::from);
    assert_eq!(
        ToolInterface::Cli
            .arguments(&args, &json!({"caption":"{entrypoint}"}), "render.py")
            .unwrap()
            .iter()
            .map(|arg| arg.resolve("/output"))
            .collect::<Vec<_>>(),
        [
            "--background",
            "--python",
            "render.py",
            "--",
            "{entrypoint}"
        ]
    );
    assert!(ToolInterface::Cli.validate_arguments(&[]).is_err());
    assert!(
        ToolInterface::Cli
            .validate_arguments(&["{entrypoint}".into(), "{entrypoint}".into()])
            .is_err()
    );
}

#[test]
fn cli_output_path_is_bound_at_execution_without_reexpanding_input() {
    let args = ["{entrypoint}", "--out", "{output}/render", "{input.text}"].map(String::from);
    let resolved = ToolInterface::Cli
        .arguments(&args, &json!({"text":"{output}"}), "render.py")
        .unwrap();
    assert_eq!(
        resolved
            .iter()
            .map(|arg| arg.resolve("/run one/output"))
            .collect::<Vec<_>>(),
        ["render.py", "--out", "/run one/output/render", "{output}"]
    );
    for invalid in [
        "--out={output}",
        "{output}/../escape",
        "{output}//absolute",
        "{output}/a/{input.text}",
        "{output}/",
    ] {
        assert!(
            ToolInterface::Cli
                .validate_arguments(&["{entrypoint}".into(), invalid.into()])
                .is_err()
        );
    }
}

#[test]
fn mcp_tool_names_are_validated_and_server_arguments_stay_literal() {
    let interface: ToolInterface =
        serde_json::from_value(json!({"mcp":{"tool":"report.build-v1"}})).unwrap();
    assert_eq!(
        serde_json::to_value(&interface).unwrap(),
        json!({"mcp":{"tool":"report.build-v1"}})
    );
    assert_eq!(
        interface
            .arguments(
                &["{input.title}".into()],
                &json!({"title":"ignored"}),
                "server.py"
            )
            .unwrap()
            .iter()
            .map(|arg| arg.resolve("/output"))
            .collect::<Vec<_>>(),
        vec!["server.py", "{input.title}"]
    );
    for name in ["", "with spaces", "report/run", &"x".repeat(129)] {
        assert!(
            ToolInterface::Mcp { tool: name.into() }
                .validate_arguments(&[])
                .is_err()
        );
    }
    assert!(
        serde_json::from_value::<ToolInterface>(
            json!({"mcp":{"tool":"report", "server":"ambient"}})
        )
        .is_err()
    );
}
