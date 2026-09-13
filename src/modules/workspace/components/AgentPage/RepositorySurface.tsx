import type { AgentTheme, AppThemeId } from "@contracts";
import { createMemo } from "solid-js";
import { useRepositoryWorkbench } from "../../../workbench/hooks/useRepositoryWorkbench.tsx";
import {
	type AgentLayoutMode,
	DEFAULT_ROWS,
	WorkspaceCanvas,
} from "../WorkspaceCanvas/index.tsx";
import { AgentMainSurface } from "./AgentMainSurface.tsx";
import type { useAgentPaneActions } from "./index.tsx";
import type { WorkspaceView } from "./retainedWorkspaces.ts";

export function RepositorySurface(props: {
	view: WorkspaceView;
	active: boolean;
	layoutMode: AgentLayoutMode;
	theme: AgentTheme;
	themeId: AppThemeId;
	onThemeChange: (id: AppThemeId) => void;
	showSettings: boolean;
	setShowSettings: (show: boolean) => void;
	actions: ReturnType<typeof useAgentPaneActions>;
	onFocusPane: (paneId: string) => void;
}) {
	const selectedPaneId = createMemo<string | null>((previous) => {
		const { group, panes } = props.view;
		return (
			panes.find((pane) => pane.id === group.selectedPaneId)?.id ??
			panes.find((pane) => pane.id === previous)?.id ??
			panes[0]?.id ??
			null
		);
	});
	const selectedPane = createMemo(() =>
		props.view.panes.find((pane) => pane.id === selectedPaneId()),
	);
	const workbench = useRepositoryWorkbench(() => ({
		get active() {
			return props.active;
		},
		get cwd() {
			return selectedPane()?.cwd;
		},
		get workspaceId() {
			return props.view.cwd ?? props.view.group.id;
		},
	}));
	const selectPane = (paneId: string) => {
		workbench.focusWorkbench(
			props.view.panes.find((pane) => pane.id === paneId)?.cwd,
		);
		props.actions.selectPane(paneId);
	};
	const grid = (
		<WorkspaceCanvas
			active={props.active && !workbench.zenMode}
			panes={props.view.panes}
			selectedPaneId={selectedPaneId()}
			columns={props.view.group.columns}
			rows={props.view.group.rows ?? DEFAULT_ROWS}
			layoutMode={props.layoutMode}
			theme={props.theme}
			onSelectPane={selectPane}
			onFocusPane={props.onFocusPane}
			onClosePane={props.actions.removePane}
			onDirectorySelect={props.actions.handleDirectorySelected}
			onDirectoryCancel={props.actions.removePane}
			onChatRef={props.actions.handleChatRef}
			onReorderPanes={props.actions.reorderPanes}
			onAddPane={props.actions.handleAddPane}
			onSetPaneAgentKind={props.actions.handleSetPaneAgentKind}
			workspaceId={props.view.cwd ?? props.view.group.id}
			legacyWorkspaceId={props.view.group.id}
			auxiliaryPanels={workbench.auxiliaryPanels}
		/>
	);
	return (
		<AgentMainSurface
			active={props.active}
			repositoryCwd={props.view.cwd ?? ""}
			paneCount={workbench.zenMode ? 0 : props.view.panes.length}
			chatDiffPanel={workbench.diffPanel}
			chatSidebar={workbench.sidebar}
			chatZenMode={props.active && workbench.zenMode}
			hasCurrentPanes={props.view.panes.length > 0}
			onThemeChange={props.onThemeChange}
			setShowSettings={props.setShowSettings}
			showSettings={props.active && props.showSettings}
			agentGrid={grid}
			themeId={props.themeId}
		/>
	);
}
