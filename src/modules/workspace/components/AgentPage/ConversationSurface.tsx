import type { Group, WorkspaceAgentKind, WorkspaceView } from "@contracts";
import type { AgentChatHandle } from "@conversation/components/AgentChatView/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import { DEFAULT_ROWS, WorkspaceCanvas } from "../WorkspaceCanvas/index.tsx";
import { styles } from "./styles.ts";

type AgentPaneActions = {
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
	projectId: string;
	group: Group | undefined;
	active: boolean;
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
			onSelectPane={props.actions.selectPane}
			onFocusPane={props.onFocusPane}
			onClosePane={props.actions.removePane}
			onDirectorySelect={props.actions.handleDirectorySelected}
			onDirectoryCancel={props.actions.removePane}
			onChatRef={props.actions.handleChatRef}
			onSetPaneAgentKind={props.actions.handleSetPaneAgentKind}
			workspaceId={props.view.key}
			legacyWorkspaceId={props.group?.id}
		/>
	);
	return (
		<div
			data-project-surface={props.projectId}
			data-project-active={props.active ? "true" : "false"}
			data-expected-panes={panes().length}
			aria-hidden={props.active ? undefined : "true"}
			{...stylex.attrs(styles.surface, !props.active && styles.inactive)}
		>
			{grid}
		</div>
	);
}
