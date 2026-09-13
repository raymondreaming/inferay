import type { AgentTheme, Pane, WorkspaceAgentKind } from "@contracts";
import type { AgentChatHandle } from "@conversation/components/AgentChatView/index.tsx";
import type { AgentLayoutMode } from "@shared/contracts/workspace.ts";

export type DragProps = {
	readonly draggable: boolean;
	readonly onDragStart: (event: PointerEvent) => void;
	readonly onCreatePanelDragStart: (
		event: PointerEvent,
		panelId: string,
		completeDrop: () => void,
	) => void;
	readonly onDragEnd: () => void;
};

export type AuxiliaryPanel = {
	readonly id: string;
	readonly onSelect?: () => void;
	readonly render: (drag: DragProps) => import("solid-js").Element;
};

export interface WorkspaceCanvasProps {
	active?: boolean;
	panes: Pane[];
	selectedPaneId: string | null;
	columns: number;
	rows: number;
	layoutMode: AgentLayoutMode;
	theme: AgentTheme;
	onSelectPane: (id: string) => void;
	onFocusPane?: (id: string) => void;
	onClosePane: (id: string) => void;
	onDirectorySelect: (
		id: string,
		path: string | null,
		references?: string[],
	) => void;
	onDirectoryCancel: (id: string) => void;
	onChatRef: (id: string, handle: AgentChatHandle | null) => void;
	onReorderPanes?: (from: number, to: number) => void;
	onAddPane?: (kind: WorkspaceAgentKind) => void;
	onSetPaneAgentKind?: (id: string, kind: WorkspaceAgentKind) => void;
	workspaceId?: string;
	legacyWorkspaceId?: string;
	auxiliaryPanels?: readonly AuxiliaryPanel[];
}

export const paneViewProps = (
	props: WorkspaceCanvasProps,
	pane: Pane,
	paneIndex: number,
	onHeaderDragStart: (event: PointerEvent, index: number) => void,
	onHeaderDragEnd: () => void,
) => ({
	pane,
	isSelected: props.active !== false && pane.id === props.selectedPaneId,
	isVisible: props.active !== false,
	onClose: props.onClosePane,
	onDirectorySelect: props.onDirectorySelect,
	onDirectoryCancel: props.onDirectoryCancel,
	chatRef: props.onChatRef,
	paneIndex,
	onHeaderDragStart,
	onHeaderDragEnd,
	onSetPaneAgentKind: props.onSetPaneAgentKind,
});
