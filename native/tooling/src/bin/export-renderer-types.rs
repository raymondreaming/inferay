use inferay_native_diff::*;
use ts_rs::{Config, TS};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../build/presentation/contracts");
    // Do not let obsolete generated declarations hide a removed backend type.
    if root.exists() {
        std::fs::remove_dir_all(&root)?;
    }
    let cfg = Config::new()
        .with_large_int("number")
        .with_out_dir(root)
        .with_import_extension(Some("ts"));
    macro_rules! export { ($($ty:ty),* $(,)?) => { $(<$ty>::export_all(&cfg)?;)* }; }
    export!(
        GitFileEntry,
        inferay_core::provider_config::ProviderCatalog,
        inferay_presentation::chat_view::ChatRow,
        inferay_presentation::chat_view::ChatWindow,
        GitStatusResult,
        GitBranch,
        GitWorktree,
        GitStash,
        GitRepositoryOperationState,
        GitOperationResult,
        GitOperationOutcome,
        GitOperationErrorKind,
        GitRefOperationPreflight,
        GitCommitFile,
        GitCommitDetails,
        GitComparisonDetails,
        GitHunkDiff,
        GitGraphSnapshot,
        GraphNavigation,
        inferay_presentation::panels::PanelSession,
        inferay_presentation::panels::PanelAction,
        inferay_presentation::liquid::EvolveOptions,
        inferay_presentation::liquid::MoveOptions,
        inferay_presentation::liquid::LiquidFrame,
        inferay_core::prompts::Prompt,
        inferay_core::prompts::SkillProposal,
        inferay_core::prompts::SkillRead,
        inferay_presentation::skills::SkillFormState,
        inferay_core::agent_state::AgentSavedState,
        inferay_core::agent_context::AgentContextUpdate,
        inferay_core::tool_presentation::ToolDisplayInfo,
        inferay_core::tool_presentation::ToolOutputSummary,
        inferay_core::tool_presentation::AskUserQuestion,
        inferay_core::agent_context::EffectiveAgentContext
    );
    inferay_server::export_renderer_types(&cfg)?;
    let catalog_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../build/presentation/provider-catalog.json");
    std::fs::write(
        catalog_path,
        serde_json::to_string(&inferay_core::provider_config::renderer_catalog(
            &serde_json::Value::Null,
            &[],
        ))?,
    )?;
    Ok(())
}
