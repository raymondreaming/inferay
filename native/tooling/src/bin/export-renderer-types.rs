use inferay_native_diff::*;
use ts_rs::{Config, TS};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../build/presentation/contracts");
    let cfg = Config::new()
        .with_large_int("number")
        .with_out_dir(root)
        .with_import_extension(Some("ts"));
    macro_rules! export { ($($ty:ty),* $(,)?) => { $(<$ty>::export_all(&cfg)?;)* }; }
    export!(
        GitFileEntry,
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
        inferay_core::agent_context::EffectiveAgentContext
    );
    Ok(())
}
