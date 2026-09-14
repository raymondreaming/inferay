import type { AgentTheme, Group, WorkspaceView } from "@contracts";
import { useRepositoryWorkbench } from "@repository/hooks/useRepositoryWorkbench.tsx";
import type { AgentLayoutMode } from "@shared/contracts/workspace.ts";
import { createMemo } from "solid-js";
import { DEFAULT_ROWS, WorkspaceCanvas } from "../WorkspaceCanvas/index.tsx";
import { AgentMainSurface } from "./AgentMainSurface.tsx";
import type { AgentPaneActions } from "./types.ts";

export function RepositorySurface(props: {
	view: WorkspaceView;
	group: Group;
	active: boolean;
	layoutMode: AgentLayoutMode;
	theme: AgentTheme;
	actions: AgentPaneActions;
	onFocusPane: (paneId: string) => void;
}) {
	const panes = createMemo(() =>
		props.view.paneIndices.map((index) => props.group.panes[index]!),
	);
	const selectedPaneId = createMemo<string | null>((previous) => {
		return (
			panes().find((pane) => pane.id === props.group.selectedPaneId)?.id ??
			panes().find((pane) => pane.id === previous)?.id ??
			panes()[0]?.id ??
			null
		);
	});
	const selectedPane = createMemo(() =>
		panes().find((pane) => pane.id === selectedPaneId()),
	);
	const workbench = useRepositoryWorkbench(() => ({
		get active() {
			return props.active;
		},
		get cwd() {
			return selectedPane()?.cwd;
		},
		get workspaceId() {
			return props.view.cwd ?? props.group.id;
		},
	}));
	const selectPane = (paneId: string) => {
		workbench.focusWorkbench(panes().find((pane) => pane.id === paneId)?.cwd);
		props.actions.selectPane(paneId);
	};
	const grid = (
		<WorkspaceCanvas
			active={props.active && !workbench.zenMode}
			panes={panes()}
			selectedPaneId={selectedPaneId()}
			columns={props.group.columns}
			rows={props.group.rows ?? DEFAULT_ROWS}
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
			workspaceId={props.view.cwd ?? props.group.id}
			legacyWorkspaceId={props.group.id}
			auxiliaryPanels={workbench.auxiliaryPanels}
		/>
	);
	return (
		<AgentMainSurface
			active={props.active}
			repositoryCwd={props.view.cwd ?? ""}
			paneCount={workbench.zenMode ? 0 : panes().length}
			chatDiffPanel={workbench.diffPanel}
			chatSidebar={workbench.sidebar}
			chatZenMode={props.active && workbench.zenMode}
			hasCurrentPanes={panes().length > 0}
			agentGrid={grid}
		/>
	);
}
