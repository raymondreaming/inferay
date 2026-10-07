import type {
	AgentTheme,
	Group,
	WorkspaceAgentKind,
	WorkspaceView,
} from "@contracts";
import type { AgentChatHandle } from "@conversation/components/AgentChatView/index.tsx";
import type { AgentLayoutMode } from "@shared/lib/native.tsx";
import { createMemo } from "solid-js";
import { DEFAULT_ROWS, WorkspaceCanvas } from "../WorkspaceCanvas/index.tsx";
import { AgentMainSurface } from "./AgentMainSurface.tsx";

type AgentPaneActions = {
	handleAddPane: (agentKind: WorkspaceAgentKind) => void;
	reorderPanes: (fromIndex: number, toIndex: number) => void;
	handleSetPaneAgentKind: (
		paneId: string,
		agentKind: WorkspaceAgentKind,
	) => void;
	handleDirectorySelected: (
		paneId: string,
		path: string | null,
		referencePaths?: string[],
	) => void;
	selectPane: (paneId: string) => void;
	handleChatRef: (id: string, handle: AgentChatHandle | null) => void;
	removePane: (paneId: string) => void;
};

export function ConversationSurface(props: {
	view: WorkspaceView;
	group: Group | undefined;
	active: boolean;
	layoutMode: AgentLayoutMode;
	theme: AgentTheme;
	actions: AgentPaneActions;
	onFocusPane: (paneId: string) => void;
}) {
	const panes = createMemo(
		() =>
			props.group?.panes.filter((_, index) =>
				props.view.paneIndices.includes(index),
			) ?? [],
	);
	const selectedPaneId = createMemo<string | null>((previous) => {
		return (
			panes().find((pane) => pane.id === props.group?.selectedPaneId)?.id ??
			panes().find((pane) => pane.id === previous)?.id ??
			panes()[0]?.id ??
			null
		);
	});
	const grid = (
		<WorkspaceCanvas
			active={props.active}
			panes={panes()}
			selectedPaneId={selectedPaneId()}
			columns={props.group?.columns ?? 2}
			rows={props.group?.rows ?? DEFAULT_ROWS}
			layoutMode={props.layoutMode}
			theme={props.theme}
			onSelectPane={props.actions.selectPane}
			onFocusPane={props.onFocusPane}
			onClosePane={props.actions.removePane}
			onDirectorySelect={props.actions.handleDirectorySelected}
			onDirectoryCancel={props.actions.removePane}
			onChatRef={props.actions.handleChatRef}
			onReorderPanes={props.actions.reorderPanes}
			onAddPane={props.actions.handleAddPane}
			onSetPaneAgentKind={props.actions.handleSetPaneAgentKind}
			workspaceId={props.view.key}
			legacyWorkspaceId={props.group?.id}
			auxiliaryPanels={[]}
		/>
	);
	return (
		<AgentMainSurface
			active={props.active}
			paneCount={panes().length}
			chatDiffPanel={null}
			chatSidebar={null}
			chatZenMode={false}
			hasCurrentPanes={panes().length > 0}
			agentGrid={grid}
		/>
	);
}
