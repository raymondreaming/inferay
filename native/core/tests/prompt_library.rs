use inferay_core::prompts::library::PromptLibrary;
use serde_json::json;

#[test]
fn rejected_skill_mutations_leave_the_library_unchanged() {
    let mut library = PromptLibrary::new(Vec::new());
    let body = json!({"name":" Review ","command":"/REVIEW","promptTemplate":" Inspect "});
    let skill = library.create(body.as_object().unwrap(), 42).unwrap();
    assert_eq!(skill.command, "review");
    assert_eq!(skill.description, "Review");
    let before = library.prompts().to_vec();
    assert!(library.create(body.as_object().unwrap(), 43).is_err());
    assert!(
        library
            .update(
                &skill.id,
                json!({"name":"","expectedUpdatedAt":42})
                    .as_object()
                    .unwrap(),
                43
            )
            .is_err()
    );
    assert!(
        library
            .update(
                &skill.id,
                json!({"name":"Revised","expectedUpdatedAt":41})
                    .as_object()
                    .unwrap(),
                43
            )
            .is_err()
    );
    assert!(library.delete("missing").is_err());
    assert_eq!(library.prompts(), before);
    library
        .update(
            &skill.id,
            json!({"name":"Revised"}).as_object().unwrap(),
            40,
        )
        .unwrap();
    assert_eq!(library.prompts()[0].updated_at, 43);
    library.delete(&skill.id).unwrap();
    assert!(library.prompts().is_empty());
}
