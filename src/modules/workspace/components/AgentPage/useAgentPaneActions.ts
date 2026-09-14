import type { AgentWorkspaceAction, WorkspaceAgentKind } from "@contracts";
import type { AgentChatHandle } from "@conversation/components/AgentChatView/index.tsx";
import {
	hasId,
	listenWindowEvent,
	REMOVE_AGENT_PANE_REQUEST_EVENT,
	type RemoveAgentPaneRequestDetail,
} from "@shared/lib/dom.tsx";
import { type Accessor, createEffect, createMemo, merge } from "solid-js";
import type { AgentPaneActionsArgs } from "./types.ts";

/** Translates pane UI actions and window requests into workspace mutations. */
export function useAgentPaneActions(options: Accessor<AgentPaneActionsArgs>) {
	const removePane = (paneId: string) => {
		const current = options();
		const group =
			current.groups.find((group) =>
				group.panes.some(hasId.bind(null, paneId)),
			) ?? current.groups.find(hasId.bind(null, current.selectedGroupId));
		if (!group) return;
		current.cleanupPane(paneId);
		current.dispatchAgentGroupAction({
			type: "removePane",
			groupId: group.id,
			paneId,
		});
	};
	createEffect(
		() => [removePane, options()],
		() =>
			listenWindowEvent(REMOVE_AGENT_PANE_REQUEST_EVENT, (event) => {
				const paneId = (event as CustomEvent<RemoveAgentPaneRequestDetail>)
					.detail?.paneId;
				if (paneId) removePane(paneId);
			}),
	);
	const actions = createMemo(() => {
		const current = options();
		const groupId = current.selectedGroupId ?? "";
		const send = (action: AgentWorkspaceAction) => {
			if (current.selectedGroupId) current.dispatchAgentGroupAction(action);
		};
		return {
			handleAddPane: (agentKind: WorkspaceAgentKind) =>
				send({ type: "addPane", groupId, agentKind }),
			reorderPanes: (fromIndex: number, toIndex: number) =>
				send({ type: "reorderPanes", groupId, fromIndex, toIndex }),
			handleSetPaneAgentKind: (paneId: string, agentKind: WorkspaceAgentKind) =>
				send({ type: "setPaneAgentKind", groupId, paneId, agentKind }),
			handleDirectorySelected: (
				paneId: string,
				path: string | null,
				referencePaths?: string[],
			) =>
				send({
					type: "directorySelected",
					groupId,
					paneId,
					path,
					referencePaths,
				}),
			selectPane: (paneId: string) =>
				send({ type: "selectPane", groupId, paneId }),
		};
	});
	const handleChatRef = (id: string, handle: AgentChatHandle | null) => {
		const current = options();
		handle ? current.chatRefs.set(id, handle) : current.chatRefs.delete(id);
	};
	return merge(() => actions(), { handleChatRef, removePane });
}
