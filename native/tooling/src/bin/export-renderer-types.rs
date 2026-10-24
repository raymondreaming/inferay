use inferay_native_diff::*;
use ts_rs::{Config, TS};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let presentation_path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../build/presentation");
    std::fs::create_dir_all(&presentation_path)?;
    // A dev rebuild and a manual check may export at the same time.
    let export_lock = std::fs::File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(presentation_path.join(".contracts.lock"))?;
    export_lock.lock()?;
    let stage = tempfile::Builder::new()
        .prefix(".contracts-")
        .tempdir_in(&presentation_path)?;
    let root = stage.path();
    let cfg = Config::new()
        .with_large_int("number")
        .with_out_dir(root)
        .with_import_extension(Some("ts"));
    macro_rules! export { ($($ty:ty),* $(,)?) => { $(<$ty>::export_all(&cfg)?;)* }; }
    export!(
        inferay_presentation::project_editor::NewAutomation,
        inferay_presentation::project_editor::SkillChoices,
        inferay_presentation::project_editor::SkillOption,
        inferay_presentation::project_editor::EditToolGrant,
        inferay_presentation::project_editor::ProposalPath,
        inferay_presentation::project_editor::TriggerPreset,
        inferay_presentation::memory_graph::MemoryGraphLayout,
        inferay_presentation::memory_graph::GraphPoint,
        inferay_core::projects::EffectState,
        inferay_core::projects::EffectPresentation,
        inferay_core::projects::ProjectHistory,
        inferay_core::projects::EffectReviewRequest,
        inferay_core::projects::EffectDelivery,
        inferay_core::projects::EffectDeliveryState,
        inferay_core::projects::EffectReceipt,
        inferay_core::projects::EffectInboxPage,
        inferay_core::table_preview::TablePreview,
        inferay_core::draft_preview::DraftPreview,
        inferay_core::connections::ConnectionInfo,
        inferay_core::connections::ConnectionCommand,
        inferay_core::project_files::ProjectDefinition,
        inferay_core::project_files::ProjectFileCatalog,
        inferay_core::project_files::ProjectWorkspace,
        inferay_core::project_files::PluginReview,
        inferay_core::project_files::AutomationReview,
        inferay_core::project_files::PluginLibrary,
        inferay_core::project_files::PluginTextFile,
        inferay_core::project_files::ProjectFileCommand,
        inferay_core::project_files::ProjectProposalRequest,
        inferay_core::project_files::ProjectProposalView,
        inferay_core::project_files::PluginProposalReview,
        inferay_core::project_files::ResourceDefinition,
        inferay_core::project_files::PluginDefinition,
        inferay_core::project_files::ToolDefinition,
        inferay_core::project_files::AgentToolGrant,
        inferay_core::project_files::AutomationDefinition,
        inferay_core::project_files::SkillDefinition,
        inferay_core::memory::MemoryNote,
        inferay_core::memory::MemoryHit,
        inferay_core::memory::MemoryNoteInput,
        inferay_core::projects::LegacyAutomationProposal,
        inferay_core::projects::LocalTool,
        inferay_core::projects::ToolInterface,
        inferay_presentation::documents::DocumentView,
        inferay_presentation::dock_session::DockRequest,
        inferay_presentation::dock::DockLayout,
        inferay_presentation::dock::DockResizePreview,
        inferay_presentation::appearance::SidebarResize,
        inferay_core::syntax::SyntaxKind,
        inferay_core::syntax::SyntaxInput,
        inferay_presentation::appearance::DropdownPosition,
        inferay_presentation::ui_performance::UiTiming,
        inferay_presentation::composer::ChatKeyAction,
        GitFileEntry,
        PreparedEditDiff,
        SequentialEdit,
        inferay_presentation::dock::Tree,
        inferay_presentation::diff::DiffNavigation,
        inferay_presentation::diff::DiffRequest,
        inferay_presentation::diff::DiffViewMode,
        inferay_presentation::graph_response::GraphData<'static>,
        inferay_presentation::graph_response::GraphSemanticPreferences<'static>,
        inferay_presentation::git_actions::GitRefOperationRequest,
        inferay_presentation::git_actions::GitGraphActionRequest,
        inferay_presentation::diff::EditDiffWindow,
        inferay_presentation::diff::DiffNavigationAction,
        inferay_presentation::workbench::WorkspaceView<'static>,
        inferay_presentation::workspace_session::WorkspaceSnapshot,
        inferay_presentation::composer::DecoratedTextSegment,
        inferay_presentation::composer::LinkMetadata,
        inferay_presentation::composer::CompletionMenuState,
        inferay_presentation::transcript::ChatEventPlan,
        inferay_presentation::chat_view::ChatScrollState,
        inferay_presentation::composer::ComposerConfigControl,
        inferay_core::chat_protocol::ChatTranscriptMessage,
        inferay_core::chat_protocol::NativeChatRender,
        inferay_core::chat_protocol::ChatTranscriptUpdate<'static>,
        inferay_core::chat_protocol::GoalCard,
        inferay_core::chat_protocol::CommandCard,
        inferay_presentation::git_actions::GitActionResponse,
        inferay_presentation::git_actions::GraphActionPresentation,
        inferay_presentation::appearance::AppearanceCatalog,
        inferay_presentation::appearance::BackgroundModel,
        inferay_presentation::workbench::ChangesPanelProjection,
        inferay_core::provider_config::ProviderCatalog,
        inferay_core::provider_config::ProviderSettingsView,
        inferay_presentation::chat_view::ChatListRow,
        inferay_presentation::graph::GraphLines,
        inferay_presentation::onboarding::OnboardingTour,
        inferay_presentation::onboarding::OnboardingRect,
        inferay_presentation::dock::DockPointerTarget,
        inferay_presentation::dock::DockWheel,
        inferay_presentation::dock::DockCanvas,
        inferay_presentation::workbench::GraphFileOpen,
        inferay_presentation::workbench::RepositoryPreferences,
        inferay_presentation::graph::GraphKeyboardNavigation,
        inferay_presentation::graph::GraphViewport,
        inferay_presentation::graph_response::GraphPresentation<'static>,
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
        inferay_presentation::panels::PanelPresentation,
        inferay_presentation::panels::FileContent,
        inferay_presentation::panels::PanelAction,
        inferay_core::prompts::Prompt,
        inferay_core::prompts::SkillProposal,
        inferay_core::prompts::SkillProposalView,
        inferay_core::prompts::SkillRead,
        inferay_presentation::skills::SkillDialogView,
        inferay_presentation::skills::SkillSaveRequest,
        inferay_core::agent_state::Workspace,
        inferay_core::workspace_action::AgentWorkspaceAction,
        inferay_core::agent_context::AgentContextUpdate,
        inferay_core::tool_presentation::ToolDisplayInfo,
        inferay_core::tool_presentation::McpElicitation,
        inferay_core::tool_presentation::ToolOutputSummary,
        inferay_core::tool_presentation::AskUserQuestion,
        inferay_core::agent_context::EffectiveAgentContext
    );
    inferay_server::export_renderer_types(&cfg)?;
    let projections = inferay_presentation::projection_contracts(&cfg);
    let source = include_str!("../../../presentation/src/lib.rs");
    let legacy = source
        .lines()
        .filter_map(|line| {
            line.trim()
                .strip_prefix('"')
                .and_then(|line| line.split_once("\" =>"))
                .map(|(name, _)| name)
        })
        .filter(|name| !projections.iter().any(|(typed, _, _)| typed == name))
        .map(|name| format!("\"{name}\""))
        .collect::<Vec<_>>()
        .join(" | ");
    let entries = projections
        .iter()
        .map(|(name, input, output)| format!("\"{name}\": {{input: {input}; output: {output}}};\n"))
        .collect::<String>();
    let imports = std::fs::read_dir(root)?
        .map(|entry| entry.map(|e| e.path()))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .filter_map(|path| {
            path.file_stem()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .filter(|name| {
            entries
                .split(|c: char| !c.is_alphanumeric() && c != '_')
                .any(|token| token == name)
        })
        .map(|name| format!("import type {{ {name} }} from \"./{name}.ts\";\n"))
        .collect::<String>();
    std::fs::write(
        root.join("PresentationContracts.ts"),
        format!(
            "{imports}export type PresentationContracts = {{{entries}}};\nexport type UntypedPresentationOperation = {legacy};\n"
        ),
    )?;
    // Keep the renderer's type-only entry point in sync with every exported dependency.
    let mut contracts = std::fs::read_dir(root)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()?;
    contracts.retain(|path| {
        path.extension().is_some_and(|extension| extension == "ts")
            && path.file_name().is_some_and(|name| name != "index.ts")
    });
    contracts.sort();
    let mut barrel = String::from("// Generated by export-renderer-types. Do not edit.\n");
    for contract in contracts {
        let filename = contract
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or("contract filename is not valid UTF-8")?;
        barrel.push_str(&format!("export type * from \"./{filename}\";\n"));
    }
    std::fs::write(root.join("index.ts"), barrel)?;
    publish_contracts(root, &presentation_path.join("contracts"))?;
    publish_file(
        &presentation_path.join("appearance-catalog.json"),
        serde_json::to_string(&inferay_presentation::appearance::catalog())?.as_bytes(),
    )?;
    publish_file(&presentation_path.join("project-policy.json"), serde_json::to_string(&serde_json::json!({"entryLimit":inferay_core::project_files::PLUGIN_ENTRY_LIMIT,"byteLimit":inferay_core::project_files::PLUGIN_BYTE_LIMIT}))?.as_bytes())?;
    let catalog_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../build/presentation/provider-catalog.json");
    publish_file(
        &catalog_path,
        serde_json::to_string(&inferay_core::provider_config::renderer_catalog(
            &serde_json::Value::Null,
            &[],
        ))?
        .as_bytes(),
    )?;
    Ok(())
}

fn publish_file(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut staged = tempfile::NamedTempFile::new_in(
        path.parent()
            .ok_or_else(|| std::io::Error::other("Missing output parent"))?,
    )?;
    staged.write_all(bytes)?;
    staged.persist(path).map_err(|error| error.error)?;
    Ok(())
}

fn publish_contracts(stage: &std::path::Path, target: &std::path::Path) -> std::io::Result<()> {
    if !stage.join("index.ts").is_file() {
        return Err(std::io::Error::other("Contract export has no entry point"));
    }
    if !target.try_exists()? {
        return std::fs::rename(stage, target);
    }
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let from = std::ffi::CString::new(stage.as_os_str().as_encoded_bytes())?;
        let to = std::ffi::CString::new(target.as_os_str().as_encoded_bytes())?;
        #[cfg(target_os = "macos")]
        let result = unsafe {
            libc::renameatx_np(
                libc::AT_FDCWD,
                from.as_ptr(),
                libc::AT_FDCWD,
                to.as_ptr(),
                libc::RENAME_SWAP,
            )
        };
        #[cfg(target_os = "linux")]
        let result = unsafe {
            libc::renameat2(
                libc::AT_FDCWD,
                from.as_ptr(),
                libc::AT_FDCWD,
                to.as_ptr(),
                libc::RENAME_EXCHANGE,
            )
        };
        if result != 0 {
            return Err(std::io::Error::last_os_error());
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        for entry in std::fs::read_dir(stage)? {
            let entry = entry?;
            if entry.file_name() != "index.ts" {
                publish_file(
                    &target.join(entry.file_name()),
                    &std::fs::read(entry.path())?,
                )?;
            }
        }
        publish_file(
            &target.join("index.ts"),
            &std::fs::read(stage.join("index.ts"))?,
        )?;
        for entry in std::fs::read_dir(target)? {
            let entry = entry?;
            if !stage.join(entry.file_name()).exists() {
                std::fs::remove_file(entry.path())?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contracts_remain_readable_during_publication_and_obsolete_types_disappear() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("contracts");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("index.ts"), "old").unwrap();
        std::fs::write(target.join("Old.ts"), "old").unwrap();
        let incomplete = tempfile::tempdir_in(root.path()).unwrap();
        assert!(publish_contracts(incomplete.path(), &target).is_err());
        assert_eq!(
            std::fs::read_to_string(target.join("index.ts")).unwrap(),
            "old"
        );
        let reading = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        let reader_path = target.clone();
        let reader_active = reading.clone();
        let reader = std::thread::spawn(move || {
            while reader_active.load(std::sync::atomic::Ordering::Relaxed) {
                let text = std::fs::read_to_string(reader_path.join("index.ts")).unwrap();
                assert!(text == "old" || text == "new");
            }
        });
        for _ in 0..30 {
            let stage = tempfile::tempdir_in(root.path()).unwrap();
            std::fs::write(stage.path().join("index.ts"), "new").unwrap();
            std::fs::write(stage.path().join("New.ts"), "new").unwrap();
            publish_contracts(stage.path(), &target).unwrap();
        }
        reading.store(false, std::sync::atomic::Ordering::Relaxed);
        reader.join().unwrap();
        assert!(!target.join("Old.ts").exists());
        assert_eq!(
            std::fs::read_to_string(target.join("New.ts")).unwrap(),
            "new"
        );
    }
}
