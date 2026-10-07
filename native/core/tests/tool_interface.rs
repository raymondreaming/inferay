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
            .unwrap(),
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
            .unwrap(),
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
            .unwrap(),
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
