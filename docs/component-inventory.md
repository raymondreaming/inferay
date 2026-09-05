# App component inventory

The app has **66 component folders** containing **223 named component implementations**, including **52 factory-generated SVG icons**. This inventory excludes `site/`, tests, imported library components, and aliases of existing components. JSX rendering helpers are listed separately.

## Folder convention

Every component family has a named folder with `index.tsx` and, when it has local styles, one `styles.ts`. Child components live beside the entry point. Folder-local hooks, types, and pure helpers also live beside it. Styles for the entry point and all of its children belong in that folder's `styles.ts`; dynamic values are passed to style helpers. SVG geometry and imperative DOM measurements stay with their rendering logic. Folders without local style rules omit `styles.ts`.

Mutually recursive `Directory`/`Entry` and `InlineTokens`/`InlineToken` renderers stay together in small files to avoid circular component imports.

Route files retain their framework-required names and import app components. Hook modules may compose imported components but do not define their own view components. The shared design-system tokens and global CSS remain centralized.

`bun run check:components` checks the folder convention, misplaced components, StyleX definitions, and inline style objects. `bun run check:architecture` includes this check.

## Complete list and natural splits

Each heading links to the component entry point. Folders with local style rules also contain `styles.ts`. The listed component names are implementations, not repeated re-exports.

### [src/app/components/AppHeader](../src/app/components/AppHeader/index.tsx)

- [index.tsx](../src/app/components/AppHeader/index.tsx): `AppHeader`.

### [src/app/components/AppLayout](../src/app/components/AppLayout/index.tsx)

- [index.tsx](../src/app/components/AppLayout/index.tsx): `AppLayout`.

### [src/app/components/CommandPalette](../src/app/components/CommandPalette/index.tsx)

- [index.tsx](../src/app/components/CommandPalette/index.tsx): `CommandPalette`.

### [src/app/components/DocumentShell](../src/app/components/DocumentShell/index.tsx)

- [index.tsx](../src/app/components/DocumentShell/index.tsx): `DocumentShell`.

### [src/app/components/IndexRoute](../src/app/components/IndexRoute/index.tsx)

- [index.tsx](../src/app/components/IndexRoute/index.tsx): `IndexRoute`.

### [src/app/components/RootComponent](../src/app/components/RootComponent/index.tsx)

- [index.tsx](../src/app/components/RootComponent/index.tsx): `RootComponent`.

### [src/modules/agents/components/AgentIcon](../src/modules/agents/components/AgentIcon/index.tsx)

- JSX rendering helpers are exported from the entry point.

### [src/modules/conversation/components/AgentChatHeader](../src/modules/conversation/components/AgentChatHeader/index.tsx)

- [SessionDropdownOption.tsx](../src/modules/conversation/components/AgentChatHeader/SessionDropdownOption.tsx): `SessionDropdownOption`.
- [index.tsx](../src/modules/conversation/components/AgentChatHeader/index.tsx): `AgentWorkspaceControl`.

### [src/modules/conversation/components/AgentChatStatusBar](../src/modules/conversation/components/AgentChatStatusBar/index.tsx)

- [index.tsx](../src/modules/conversation/components/AgentChatStatusBar/index.tsx): `AgentChatStatusBar`.

### [src/modules/conversation/components/AgentChatView](../src/modules/conversation/components/AgentChatView/index.tsx)

- [DirectoryPickerModal.tsx](../src/modules/conversation/components/AgentChatView/DirectoryPickerModal.tsx): `DirectoryPickerModal`.
- [index.tsx](../src/modules/conversation/components/AgentChatView/index.tsx): `AgentChatView`.
- Supporting files: [useAgentChatSettings.ts](../src/modules/conversation/components/AgentChatView/useAgentChatSettings.ts), [useChatUiState.ts](../src/modules/conversation/components/AgentChatView/useChatUiState.ts), [useChatViewport.ts](../src/modules/conversation/components/AgentChatView/useChatViewport.ts), [usePendingChatWorkspace.ts](../src/modules/conversation/components/AgentChatView/usePendingChatWorkspace.ts), [usePersistentChatMessages.ts](../src/modules/conversation/components/AgentChatView/usePersistentChatMessages.ts), [useStableCallback.ts](../src/modules/conversation/components/AgentChatView/useStableCallback.ts).

### [src/modules/conversation/components/AgentContextPanel](../src/modules/conversation/components/AgentContextPanel/index.tsx)

- [index.tsx](../src/modules/conversation/components/AgentContextPanel/index.tsx): `AgentContextPanel`.

### [src/modules/conversation/components/ChatComposer](../src/modules/conversation/components/ChatComposer/index.tsx)

- [CommandMenu.tsx](../src/modules/conversation/components/ChatComposer/CommandMenu.tsx): `CommandMenu`.
- [CommandMenuRow.tsx](../src/modules/conversation/components/ChatComposer/CommandMenuRow.tsx): `CommandMenuRow`.
- [ComposerAttachments.tsx](../src/modules/conversation/components/ChatComposer/ComposerAttachments.tsx): `ComposerAttachments`.
- [ComposerControls.tsx](../src/modules/conversation/components/ChatComposer/ComposerControls.tsx): `ComposerControls`.
- [FileMenu.tsx](../src/modules/conversation/components/ChatComposer/FileMenu.tsx): `FileMenu`.
- [FileMenuRow.tsx](../src/modules/conversation/components/ChatComposer/FileMenuRow.tsx): `FileMenuRow`.
- [MarkdownPreviewDialog.tsx](../src/modules/conversation/components/ChatComposer/MarkdownPreviewDialog.tsx): `MarkdownPreviewDialog`.
- [ProviderConfigMenu.tsx](../src/modules/conversation/components/ChatComposer/ProviderConfigMenu.tsx): `ProviderConfigMenu`.
- [QueuedMessageRow.tsx](../src/modules/conversation/components/ChatComposer/QueuedMessageRow.tsx): `QueuedMessageRow`.
- [QueuedMessages.tsx](../src/modules/conversation/components/ChatComposer/QueuedMessages.tsx): `QueuedMessages`.
- [index.tsx](../src/modules/conversation/components/ChatComposer/index.tsx): `ChatComposer`.
- Supporting files: [useChatComposerState.tsx](../src/modules/conversation/components/ChatComposer/useChatComposerState.tsx).

### [src/modules/conversation/components/ChatEditDiff](../src/modules/conversation/components/ChatEditDiff/index.tsx)

- [EditDiffCard.tsx](../src/modules/conversation/components/ChatEditDiff/EditDiffCard.tsx): `EditDiffCard`.
- [MiniEditDiff.tsx](../src/modules/conversation/components/ChatEditDiff/MiniEditDiff.tsx): `MiniEditDiff`.
- [index.tsx](../src/modules/conversation/components/ChatEditDiff/index.tsx): `GroupedEditDiff`.

### [src/modules/conversation/components/ChatMessageList](../src/modules/conversation/components/ChatMessageList/index.tsx)

- [Bubble.tsx](../src/modules/conversation/components/ChatMessageList/Bubble.tsx): `Bubble`.
- [CheckpointMarker.tsx](../src/modules/conversation/components/ChatMessageList/CheckpointMarker.tsx): `CheckpointMarker`.
- [CommandSystemCard.tsx](../src/modules/conversation/components/ChatMessageList/CommandSystemCard.tsx): `CommandSystemCard`.
- [GoalSystemCard.tsx](../src/modules/conversation/components/ChatMessageList/GoalSystemCard.tsx): `GoalSystemCard`.
- [ToolOutputHighlight.tsx](../src/modules/conversation/components/ChatMessageList/ToolOutputHighlight.tsx): `ToolOutputHighlight`.
- [ToolTimeline.tsx](../src/modules/conversation/components/ChatMessageList/ToolTimeline.tsx): `ToolTimeline`.
- [index.tsx](../src/modules/conversation/components/ChatMessageList/index.tsx): `ChatMessageList`.
- Supporting files: [shared.ts](../src/modules/conversation/components/ChatMessageList/shared.ts).

### [src/modules/conversation/components/ChatPaneBoundary](../src/modules/conversation/components/ChatPaneBoundary/index.tsx)

- [ChatPaneRecovery.tsx](../src/modules/conversation/components/ChatPaneBoundary/ChatPaneRecovery.tsx): `ChatPaneRecovery`.
- [index.tsx](../src/modules/conversation/components/ChatPaneBoundary/index.tsx): `ChatPaneBoundary`.

### [src/modules/conversation/components/ChatRichContent](../src/modules/conversation/components/ChatRichContent/index.tsx)

- [CopyButton.tsx](../src/modules/conversation/components/ChatRichContent/CopyButton.tsx): `CopyButton`.
- [CopyablePre.tsx](../src/modules/conversation/components/ChatRichContent/CopyablePre.tsx): `CopyablePre`.
- [Inline.tsx](../src/modules/conversation/components/ChatRichContent/Inline.tsx): `Inline`.
- [Markdown.tsx](../src/modules/conversation/components/ChatRichContent/Markdown.tsx): `Markdown`.
- [MarkdownBlocks.tsx](../src/modules/conversation/components/ChatRichContent/MarkdownBlocks.tsx): `MarkdownBlocks`.
- [index.tsx](../src/modules/conversation/components/ChatRichContent/index.tsx): `AskUserQuestionCard`.

### [src/modules/conversation/components/ChatTokenDecorators](../src/modules/conversation/components/ChatTokenDecorators/index.tsx)

- Supporting files: [token-ranges.ts](../src/modules/conversation/components/ChatTokenDecorators/token-ranges.ts).
- JSX rendering helpers are exported from the entry point.

### [src/modules/explorer/components/Explorer](../src/modules/explorer/components/Explorer/index.tsx)

- [Directory.tsx](../src/modules/explorer/components/Explorer/Directory.tsx): `Directory`, `Entry`.
- [index.tsx](../src/modules/explorer/components/Explorer/index.tsx): `Explorer`.
- Supporting files: [shared.ts](../src/modules/explorer/components/Explorer/shared.ts).

### [src/modules/explorer/components/FileSearch](../src/modules/explorer/components/FileSearch/index.tsx)

- [index.tsx](../src/modules/explorer/components/FileSearch/index.tsx): `FileSearch`.

### [src/modules/explorer/components/FileTypeIcon](../src/modules/explorer/components/FileTypeIcon/index.tsx)

- [FolderTypeIcon.tsx](../src/modules/explorer/components/FileTypeIcon/FolderTypeIcon.tsx): `FolderTypeIcon`.
- [index.tsx](../src/modules/explorer/components/FileTypeIcon/index.tsx): `FileTypeIcon`.
- Supporting files: [shared.ts](../src/modules/explorer/components/FileTypeIcon/shared.ts).

### [src/modules/images/components/ImagesPage](../src/modules/images/components/ImagesPage/index.tsx)

- [index.tsx](../src/modules/images/components/ImagesPage/index.tsx): `ImagesPage`.

### [src/modules/onboarding/components/OnboardingPage](../src/modules/onboarding/components/OnboardingPage/index.tsx)

- [GithubStep.tsx](../src/modules/onboarding/components/OnboardingPage/GithubStep.tsx): `GithubStep`.
- [IntroStep.tsx](../src/modules/onboarding/components/OnboardingPage/IntroStep.tsx): `IntroStep`.
- [ProjectsStep.tsx](../src/modules/onboarding/components/OnboardingPage/ProjectsStep.tsx): `ProjectsStep`.
- [index.tsx](../src/modules/onboarding/components/OnboardingPage/index.tsx): `OnboardingPage`.
- Supporting files: [shared.ts](../src/modules/onboarding/components/OnboardingPage/shared.ts).

### [src/modules/onboarding/components/OnboardingRoute](../src/modules/onboarding/components/OnboardingRoute/index.tsx)

- [index.tsx](../src/modules/onboarding/components/OnboardingRoute/index.tsx): `OnboardingRoute`.

### [src/modules/settings/components/Settings](../src/modules/settings/components/Settings/index.tsx)

- [BackgroundScenePicker.tsx](../src/modules/settings/components/Settings/BackgroundScenePicker.tsx): `BackgroundScenePicker`.
- [GlobalAgentInstructionsSection.tsx](../src/modules/settings/components/Settings/GlobalAgentInstructionsSection.tsx): `GlobalAgentInstructionsSection`.
- [SearchFoldersSection.tsx](../src/modules/settings/components/Settings/SearchFoldersSection.tsx): `SearchFoldersSection`.
- [SettingsContent.tsx](../src/modules/settings/components/Settings/SettingsContent.tsx): `SettingsContent`.
- [ThemeOrb.tsx](../src/modules/settings/components/Settings/ThemeOrb.tsx): `ThemeOrb`.
- [WorkspaceLayoutSection.tsx](../src/modules/settings/components/Settings/WorkspaceLayoutSection.tsx): `WorkspaceLayoutSection`.
- [index.tsx](../src/modules/settings/components/Settings/index.tsx): `Settings`.

### [src/modules/settings/components/SettingsGithub](../src/modules/settings/components/SettingsGithub/index.tsx)

- [SettingsGithubEmptyState.tsx](../src/modules/settings/components/SettingsGithub/SettingsGithubEmptyState.tsx): `SettingsGithubEmptyState`.
- [SettingsRepoRow.tsx](../src/modules/settings/components/SettingsGithub/SettingsRepoRow.tsx): `SettingsRepoRow`.
- [index.tsx](../src/modules/settings/components/SettingsGithub/index.tsx): `SettingsGithubAccount`.

### [src/modules/settings/components/SettingsModal](../src/modules/settings/components/SettingsModal/index.tsx)

- [index.tsx](../src/modules/settings/components/SettingsModal/index.tsx): `SettingsModalHost`.

### [src/modules/settings/components/SettingsModalContent](../src/modules/settings/components/SettingsModalContent/index.tsx)

- [SettingsSection.tsx](../src/modules/settings/components/SettingsModalContent/SettingsSection.tsx): `SettingsSection`.
- [index.tsx](../src/modules/settings/components/SettingsModalContent/index.tsx): `SettingsModalContent`.

### [src/modules/settings/components/SettingsStatus](../src/modules/settings/components/SettingsStatus/index.tsx)

- [SettingsSuccessBanner.tsx](../src/modules/settings/components/SettingsStatus/SettingsSuccessBanner.tsx): `SettingsSuccessBanner`.
- [index.tsx](../src/modules/settings/components/SettingsStatus/index.tsx): `SettingsErrorBanner`.

### [src/modules/skills/components/SkillEditor](../src/modules/skills/components/SkillEditor/index.tsx)

- [index.tsx](../src/modules/skills/components/SkillEditor/index.tsx): `SkillEditor`.

### [src/modules/skills/components/SkillProposalCard](../src/modules/skills/components/SkillProposalCard/index.tsx)

- [SkillReadCard.tsx](../src/modules/skills/components/SkillProposalCard/SkillReadCard.tsx): `SkillReadCard`.
- [index.tsx](../src/modules/skills/components/SkillProposalCard/index.tsx): `SkillProposalCard`.

### [src/modules/skills/components/SkillsModal](../src/modules/skills/components/SkillsModal/index.tsx)

- [SkillsDialog.tsx](../src/modules/skills/components/SkillsModal/SkillsDialog.tsx): `SkillsDialog`.
- [index.tsx](../src/modules/skills/components/SkillsModal/index.tsx): `SkillsModalHost`.

### [src/modules/workbench/changes/components/ChangesPanel](../src/modules/workbench/changes/components/ChangesPanel/index.tsx)

- [ChangesPanelHeader.tsx](../src/modules/workbench/changes/components/ChangesPanel/ChangesPanelHeader.tsx): `ChangesPanelHeader`.
- [CollapsedChangesPanel.tsx](../src/modules/workbench/changes/components/ChangesPanel/CollapsedChangesPanel.tsx): `CollapsedChangesPanel`.
- [CommitDetailsPanel.tsx](../src/modules/workbench/changes/components/ChangesPanel/CommitDetailsPanel.tsx): `CommitDetailsPanel`.
- [CommitSection.tsx](../src/modules/workbench/changes/components/ChangesPanel/CommitSection.tsx): `CommitSection`.
- [ComparisonDetailsPanel.tsx](../src/modules/workbench/changes/components/ChangesPanel/ComparisonDetailsPanel.tsx): `ComparisonDetailsPanel`.
- [DetailIdentity.tsx](../src/modules/workbench/changes/components/ChangesPanel/DetailIdentity.tsx): `DetailIdentity`.
- [FileActionIcon.tsx](../src/modules/workbench/changes/components/ChangesPanel/FileActionIcon.tsx): `FileActionIcon`.
- [FileChangeIcon.tsx](../src/modules/workbench/changes/components/ChangesPanel/FileChangeIcon.tsx): `FileChangeIcon`.
- [FileChangeTotals.tsx](../src/modules/workbench/changes/components/ChangesPanel/FileChangeTotals.tsx): `FileChangeTotals`.
- [FileDiffStats.tsx](../src/modules/workbench/changes/components/ChangesPanel/FileDiffStats.tsx): `FileDiffStats`.
- [FileGroup.tsx](../src/modules/workbench/changes/components/ChangesPanel/FileGroup.tsx): `FileGroup`.
- [FileStatusIcon.tsx](../src/modules/workbench/changes/components/ChangesPanel/FileStatusIcon.tsx): `FileStatusIcon`.
- [FileViewToggle.tsx](../src/modules/workbench/changes/components/ChangesPanel/FileViewToggle.tsx): `FileViewToggle`.
- [HistoricalFileList.tsx](../src/modules/workbench/changes/components/ChangesPanel/HistoricalFileList.tsx): `HistoricalFileList`.
- [TreeNodeRow.tsx](../src/modules/workbench/changes/components/ChangesPanel/TreeNodeRow.tsx): `TreeNodeRow`.
- [index.tsx](../src/modules/workbench/changes/components/ChangesPanel/index.tsx): `ChangesPanel`.
- Supporting files: [shared.ts](../src/modules/workbench/changes/components/ChangesPanel/shared.ts).

### [src/modules/workbench/components/ChatDiffPanel](../src/modules/workbench/components/ChatDiffPanel/index.tsx)

- [DiffFilePath.tsx](../src/modules/workbench/components/ChatDiffPanel/DiffFilePath.tsx): `DiffFilePath`.
- [GraphActionDialog.tsx](../src/modules/workbench/components/ChatDiffPanel/GraphActionDialog.tsx): `GraphActionDialog`.
- [RefOperationDialog.tsx](../src/modules/workbench/components/ChatDiffPanel/RefOperationDialog.tsx): `RefOperationDialog`.
- [RepositoryOperationBar.tsx](../src/modules/workbench/components/ChatDiffPanel/RepositoryOperationBar.tsx): `RepositoryOperationBar`.
- [ViewerHeader.tsx](../src/modules/workbench/components/ChatDiffPanel/ViewerHeader.tsx): `ViewerHeader`.
- [index.tsx](../src/modules/workbench/components/ChatDiffPanel/index.tsx): `ChatDiffPanel`.
- Supporting files: [operation-model.ts](../src/modules/workbench/components/ChatDiffPanel/operation-model.ts), [useChatDiffPanelState.tsx](../src/modules/workbench/components/ChatDiffPanel/useChatDiffPanelState.tsx).

### [src/modules/workbench/components/WorkbenchPanels](../src/modules/workbench/components/WorkbenchPanels/index.tsx)

- [WorkbenchSidebar.tsx](../src/modules/workbench/components/WorkbenchPanels/WorkbenchSidebar.tsx): `WorkbenchSidebar`.
- [index.tsx](../src/modules/workbench/components/WorkbenchPanels/index.tsx): `WorkbenchDiffRail`.

### [src/modules/workbench/components/WorkspaceDockHandle](../src/modules/workbench/components/WorkspaceDockHandle/index.tsx)

- [index.tsx](../src/modules/workbench/components/WorkspaceDockHandle/index.tsx): `WorkspaceDockHandle`.

### [src/modules/workbench/diff/components/DiffViewer](../src/modules/workbench/diff/components/DiffViewer/index.tsx)

- [DiffGutterCells.tsx](../src/modules/workbench/diff/components/DiffViewer/DiffGutterCells.tsx): `DiffGutterCells`.
- [DiffGutterRow.tsx](../src/modules/workbench/diff/components/DiffViewer/DiffGutterRow.tsx): `DiffGutterRow`.
- [DiffHeader.tsx](../src/modules/workbench/diff/components/DiffViewer/DiffHeader.tsx): `DiffHeader`.
- [DiffMinimap.tsx](../src/modules/workbench/diff/components/DiffViewer/DiffMinimap.tsx): `DiffMinimap`.
- [DiffRow.tsx](../src/modules/workbench/diff/components/DiffViewer/DiffRow.tsx): `DiffRow`.
- [DiffViewButton.tsx](../src/modules/workbench/diff/components/DiffViewer/DiffViewButton.tsx): `DiffViewButton`.
- [DiffViewToolbar.tsx](../src/modules/workbench/diff/components/DiffViewer/DiffViewToolbar.tsx): `DiffViewToolbar`.
- [MergeConflictPanel.tsx](../src/modules/workbench/diff/components/DiffViewer/MergeConflictPanel.tsx): `MergeConflictPanel`.
- [SinglePanel.tsx](../src/modules/workbench/diff/components/DiffViewer/SinglePanel.tsx): `SinglePanel`.
- [VirtualPanel.tsx](../src/modules/workbench/diff/components/DiffViewer/VirtualPanel.tsx): `VirtualPanel`.
- [VirtualSplitPanel.tsx](../src/modules/workbench/diff/components/DiffViewer/VirtualSplitPanel.tsx): `VirtualSplitPanel`.
- [index.tsx](../src/modules/workbench/diff/components/DiffViewer/index.tsx): `DiffViewer`.
- Supporting files: [shared.ts](../src/modules/workbench/diff/components/DiffViewer/shared.ts).

### [src/modules/workbench/diff/components/DiffViewerBoundary](../src/modules/workbench/diff/components/DiffViewerBoundary/index.tsx)

- [DiffFallback.tsx](../src/modules/workbench/diff/components/DiffViewerBoundary/DiffFallback.tsx): `DiffFallback`.
- [index.tsx](../src/modules/workbench/diff/components/DiffViewerBoundary/index.tsx): `DiffViewerBoundary`.

### [src/modules/workbench/diff/components/MarkdownPreview](../src/modules/workbench/diff/components/MarkdownPreview/index.tsx)

- [BlockRenderer.tsx](../src/modules/workbench/diff/components/MarkdownPreview/BlockRenderer.tsx): `BlockRenderer`.
- [InlineTokens.tsx](../src/modules/workbench/diff/components/MarkdownPreview/InlineTokens.tsx): `InlineTokens`, `InlineToken`.
- [ListItemRenderer.tsx](../src/modules/workbench/diff/components/MarkdownPreview/ListItemRenderer.tsx): `ListItemRenderer`.
- [MermaidBlock.tsx](../src/modules/workbench/diff/components/MarkdownPreview/MermaidBlock.tsx): `MermaidBlock`.
- [index.tsx](../src/modules/workbench/diff/components/MarkdownPreview/index.tsx): `MarkdownPreview`.

### [src/modules/workbench/documents/components/DocumentViewer](../src/modules/workbench/documents/components/DocumentViewer/index.tsx)

- [SourcePreview.tsx](../src/modules/workbench/documents/components/DocumentViewer/SourcePreview.tsx): `SourcePreview`.
- [index.tsx](../src/modules/workbench/documents/components/DocumentViewer/index.tsx): `DocumentViewer`.
- Supporting files: [shared.ts](../src/modules/workbench/documents/components/DocumentViewer/shared.ts).

### [src/modules/workbench/graph/components/CommitGraph](../src/modules/workbench/graph/components/CommitGraph/index.tsx)

- [AuthorAvatar.tsx](../src/modules/workbench/graph/components/CommitGraph/AuthorAvatar.tsx): `AuthorAvatar`.
- [ColumnResizeHandle.tsx](../src/modules/workbench/graph/components/CommitGraph/ColumnResizeHandle.tsx): `ColumnResizeHandle`.
- [CommitRow.tsx](../src/modules/workbench/graph/components/CommitGraph/CommitRow.tsx): `CommitRow`.
- [HeaderRow.tsx](../src/modules/workbench/graph/components/CommitGraph/HeaderRow.tsx): `HeaderRow`.
- [MergeNode.tsx](../src/modules/workbench/graph/components/CommitGraph/MergeNode.tsx): `MergeNode`.
- [RefBadge.tsx](../src/modules/workbench/graph/components/CommitGraph/RefBadge.tsx): `RefBadge`.
- [RefBadges.tsx](../src/modules/workbench/graph/components/CommitGraph/RefBadges.tsx): `RefBadges`.
- [RefContextMenu.tsx](../src/modules/workbench/graph/components/CommitGraph/RefContextMenu.tsx): `RefContextMenu`.
- [RefIcon.tsx](../src/modules/workbench/graph/components/CommitGraph/RefIcon.tsx): `RefIcon`.
- [RowContextMenu.tsx](../src/modules/workbench/graph/components/CommitGraph/RowContextMenu.tsx): `RowContextMenu`.
- [index.tsx](../src/modules/workbench/graph/components/CommitGraph/index.tsx): `CommitGraph`.
- Supporting files: [graph-preferences.ts](../src/modules/workbench/graph/components/CommitGraph/graph-preferences.ts), [shared.ts](../src/modules/workbench/graph/components/CommitGraph/shared.ts), [useCommitGraphState.tsx](../src/modules/workbench/graph/components/CommitGraph/useCommitGraphState.tsx).

### [src/modules/workspace/components/AgentPage](../src/modules/workspace/components/AgentPage/index.tsx)

- [AgentMainSurface.tsx](../src/modules/workspace/components/AgentPage/AgentMainSurface.tsx): `AgentMainSurface`.
- [index.tsx](../src/modules/workspace/components/AgentPage/index.tsx): `AgentPage`.
- Supporting files: [shared.ts](../src/modules/workspace/components/AgentPage/shared.ts), [useAgentPaneActions.ts](../src/modules/workspace/components/AgentPage/useAgentPaneActions.ts), [useAgentPersistence.ts](../src/modules/workspace/components/AgentPage/useAgentPersistence.ts).

### [src/modules/workspace/components/InlineDirectoryPicker](../src/modules/workspace/components/InlineDirectoryPicker/index.tsx)

- [index.tsx](../src/modules/workspace/components/InlineDirectoryPicker/index.tsx): `InlineDirectoryPicker`.

### [src/modules/workspace/components/PaneView](../src/modules/workspace/components/PaneView/index.tsx)

- [index.tsx](../src/modules/workspace/components/PaneView/index.tsx): `PaneView`.

### [src/modules/workspace/components/RepositoryWorkspaceBar](../src/modules/workspace/components/RepositoryWorkspaceBar/index.tsx)

- [index.tsx](../src/modules/workspace/components/RepositoryWorkspaceBar/index.tsx): `RepositoryWorkspaceBar`.

### [src/modules/workspace/components/WorkspaceCanvas](../src/modules/workspace/components/WorkspaceCanvas/index.tsx)

- [index.tsx](../src/modules/workspace/components/WorkspaceCanvas/index.tsx): `WorkspaceCanvas`.
- Supporting files: [canvas-model.ts](../src/modules/workspace/components/WorkspaceCanvas/canvas-model.ts).

### [src/modules/workspace/components/WorkspaceSidebar](../src/modules/workspace/components/WorkspaceSidebar/index.tsx)

- [PaneSummaryItem.tsx](../src/modules/workspace/components/WorkspaceSidebar/PaneSummaryItem.tsx): `PaneSummaryItem`.
- [SidebarChatList.tsx](../src/modules/workspace/components/WorkspaceSidebar/SidebarChatList.tsx): `SidebarChatList`.
- [SidebarFooter.tsx](../src/modules/workspace/components/WorkspaceSidebar/SidebarFooter.tsx): `SidebarFooter`.
- [SidebarWorkspacesSection.tsx](../src/modules/workspace/components/WorkspaceSidebar/SidebarWorkspacesSection.tsx): `SidebarWorkspacesSection`.
- [index.tsx](../src/modules/workspace/components/WorkspaceSidebar/index.tsx): `WorkspaceSidebar`.
- Supporting files: [shared.ts](../src/modules/workspace/components/WorkspaceSidebar/shared.ts).

### [src/shared/ui/BorderBeamOverlay](../src/shared/ui/BorderBeamOverlay/index.tsx)

- [index.tsx](../src/shared/ui/BorderBeamOverlay/index.tsx): `BorderBeamOverlay`.

### [src/shared/ui/Button](../src/shared/ui/Button/index.tsx)

- [index.tsx](../src/shared/ui/Button/index.tsx): `Button`.

### [src/shared/ui/DotMatrixLoader](../src/shared/ui/DotMatrixLoader/index.tsx)

- [DotMatrixRipple.tsx](../src/shared/ui/DotMatrixLoader/DotMatrixRipple.tsx): `DotMatrixRipple`.
- [DotMatrixWeave.tsx](../src/shared/ui/DotMatrixLoader/DotMatrixWeave.tsx): `DotMatrixWeave`.
- [ThinkingIndicator.tsx](../src/shared/ui/DotMatrixLoader/ThinkingIndicator.tsx): `ThinkingIndicator`.
- [index.tsx](../src/shared/ui/DotMatrixLoader/index.tsx): `DotMatrixLoader`.
- Supporting files: [shared.ts](../src/shared/ui/DotMatrixLoader/shared.ts).

### [src/shared/ui/DropdownButton](../src/shared/ui/DropdownButton/index.tsx)

- [DropdownCustomOption.tsx](../src/shared/ui/DropdownButton/DropdownCustomOption.tsx): `DropdownCustomOption`.
- [index.tsx](../src/shared/ui/DropdownButton/index.tsx): `DropdownButton`.
- Supporting files: [shared.ts](../src/shared/ui/DropdownButton/shared.ts).

### [src/shared/ui/ErrorBoundary](../src/shared/ui/ErrorBoundary/index.tsx)

- [RecoveryFallback.tsx](../src/shared/ui/ErrorBoundary/RecoveryFallback.tsx): `RecoveryFallback`.
- [index.tsx](../src/shared/ui/ErrorBoundary/index.tsx): `ErrorBoundary`.

### [src/shared/ui/IconButton](../src/shared/ui/IconButton/index.tsx)

- [index.tsx](../src/shared/ui/IconButton/index.tsx): `IconButton`.

### [src/shared/ui/Icons](../src/shared/ui/Icons/index.tsx)

- [index.tsx](../src/shared/ui/Icons/index.tsx): `CommitGraphLinesLayer`.
- [shared.tsx](../src/shared/ui/Icons/shared.tsx): `IconAgent`, `IconX`, `IconPlus`, `IconMinus`, `IconCheck`, `IconRefreshCw`, `IconTrash`, `IconLayoutRows`, `IconFolder`, `IconFolderOpen`, `IconMic`, `IconPencil`, `IconGlobe`, `IconWrench`, `IconAlertTriangle`, `IconCode`, `IconRobot`, `IconSlash`, `IconFilePlus`, `IconClock`, `IconWorkflow`, `IconCopy`, `IconSend`, `IconHelpCircle`, `IconArrowDown`, `IconArrowUp`, `IconTag`, `IconCloud`, `IconComputer`, `IconPanelLeft`, `IconPanelRight`, `IconExternalLink`, `IconArrowLeft`, `IconMessageCircle`, `IconExpand`, `IconCollapse`, `IconChevronRight`, `IconChevronDown`, `IconLayoutGrid`, `IconTarget`, `IconLoader`, `IconSparkles`, `IconGitBranch`, `IconEye`, `IconSearch`, `IconGitCommit`, `IconStop`, `IconFolderFill`, `IconAnthropic`, `IconOpenAI`, `IconUser`, `IconSettings`.

### [src/shared/ui/Surface](../src/shared/ui/Surface/index.tsx)

- [index.tsx](../src/shared/ui/Surface/index.tsx): `Notice`.

### [src/shared/ui/TextInput](../src/shared/ui/TextInput/index.tsx)

- [index.tsx](../src/shared/ui/TextInput/index.tsx): `TextInput`.

### [src/shared/ui/WorkspacePage](../src/shared/ui/WorkspacePage/index.tsx)

- [index.tsx](../src/shared/ui/WorkspacePage/index.tsx): `WorkspaceEmptyState`.

### [src/shared/ui/gooey/Gooey](../src/shared/ui/gooey/Gooey/index.tsx)

- [index.tsx](../src/shared/ui/gooey/Gooey/index.tsx): `GooeyRoot`.

### [src/shared/ui/gooey/GooeyItem](../src/shared/ui/gooey/GooeyItem/index.tsx)

- [MirroredItem.tsx](../src/shared/ui/gooey/GooeyItem/MirroredItem.tsx): `MirroredItem`.
- [ObservedItem.tsx](../src/shared/ui/gooey/GooeyItem/ObservedItem.tsx): `ObservedItem`.
- [index.tsx](../src/shared/ui/gooey/GooeyItem/index.tsx): `GooeyItem`.
- Supporting files: [shared.ts](../src/shared/ui/gooey/GooeyItem/shared.ts).

### [src/shared/ui/gooey/LiquidAction](../src/shared/ui/gooey/LiquidAction/index.tsx)

- [index.tsx](../src/shared/ui/gooey/LiquidAction/index.tsx): `LiquidAction`.

### [src/shared/ui/gooey/LiquidActionSurface](../src/shared/ui/gooey/LiquidActionSurface/index.tsx)

- [index.tsx](../src/shared/ui/gooey/LiquidActionSurface/index.tsx): `LiquidActionSurface`.

### [src/shared/ui/gooey/LiquidItem](../src/shared/ui/gooey/LiquidItem/index.tsx)

- [index.tsx](../src/shared/ui/gooey/LiquidItem/index.tsx): `LiquidItem`.

### [src/shared/ui/gooey/LiquidPanel](../src/shared/ui/gooey/LiquidPanel/index.tsx)

- [index.tsx](../src/shared/ui/gooey/LiquidPanel/index.tsx): `LiquidPanel`.
- Supporting files: [shared.ts](../src/shared/ui/gooey/LiquidPanel/shared.ts).

### [src/shared/ui/gooey/LiquidPanelSurface](../src/shared/ui/gooey/LiquidPanelSurface/index.tsx)

- [index.tsx](../src/shared/ui/gooey/LiquidPanelSurface/index.tsx): `LiquidPanelSurface`.

### [src/shared/ui/gooey/LiquidPopoverSurface](../src/shared/ui/gooey/LiquidPopoverSurface/index.tsx)

- [index.tsx](../src/shared/ui/gooey/LiquidPopoverSurface/index.tsx): `LiquidPopoverSurface`.

### [src/shared/ui/gooey/LiquidSegmentedRail](../src/shared/ui/gooey/LiquidSegmentedRail/index.tsx)

- [index.tsx](../src/shared/ui/gooey/LiquidSegmentedRail/index.tsx): `LiquidSegmentedRail`.

### [src/shared/ui/gooey/filter](../src/shared/ui/gooey/filter/index.tsx)

- [InsetPass.tsx](../src/shared/ui/gooey/filter/InsetPass.tsx): `InsetPass`.
- [ShadowPass.tsx](../src/shared/ui/gooey/filter/ShadowPass.tsx): `ShadowPass`.
- [index.tsx](../src/shared/ui/gooey/filter/index.tsx): `GooFilterPrimitives`.

## Shared aliases and rendering helpers

- `shared/ui/gooey/index.ts` exports `Liquid` (the `GooeyRoot` component with `LiquidItem` attached), its `Gooey` alias, and the existing primitive exports. These aliases do not add component implementations.
- `AgentIcon/index.tsx` exports `getAgentIcon`, which chooses an existing icon.
- `ChatTokenDecorators/index.tsx` exports `renderInputHighlights` and `renderTextPills`; `token-ranges.ts` handles matching, and `styles.ts` styles both renderers.
- `Icons/shared.tsx` contains the SVG factories and their named icon instances.
