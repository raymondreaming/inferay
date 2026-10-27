fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if std::env::args().nth(1).as_deref() == Some("--agent-eval") {
        println!("{}", inferay_server::api_reference::agent_eval_contract());
        return Ok(());
    }
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs/reference");
    std::fs::create_dir_all(&root)?;
    for (name, value) in inferay_server::api_reference::artifacts()? {
        std::fs::write(
            root.join(name),
            format!("{}\n", serde_json::to_string_pretty(&value)?),
        )?;
    }
    Ok(())
}
