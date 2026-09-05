import { useCallback, useEffect, useMemo } from "octane";
import { hasId } from "../../../../shared/lib/data.ts";
import { listenWindowEvent } from "../../../../shared/lib/react-events.ts";
import type { AgentChatHandle } from "../../../conversation/components/AgentChatView/index.tsx";
import {
	type AgentKind,
	REMOVE_AGENT_PANE_REQUEST_EVENT,
	type RemoveAgentPaneRequestDetail,
} from "../../model/workspace-model.ts";
import type { AgentPaneActionsArgs } from "./index.tsx";

export function useAgentPaneActions({
	chatRefs,
	cleanupPane,
	dispatchAgentGroupAction,
	groups,
	selectedGroupId,
}: AgentPaneActionsArgs) {
	const removePane = useCallback(
		(paneId: string, _force?: boolean) => {
			const group =
				groups.find((item) => item.panes.some(hasId.bind(null, paneId))) ??
				(selectedGroupId
					? groups.find(hasId.bind(null, selectedGroupId))
					: null);
			if (!group) return;
			cleanupPane(paneId);
			dispatchAgentGroupAction(
				{
					type: "removePane",
					groupId: group.id,
					paneId,
				},
				"remove-pane",
			);
		},
		[cleanupPane, dispatchAgentGroupAction, groups, selectedGroupId],
	);
	useEffect(
		() =>
			listenWindowEvent(REMOVE_AGENT_PANE_REQUEST_EVENT, (event) => {
				const paneId = (event as CustomEvent<RemoveAgentPaneRequestDetail>)
					.detail?.paneId;
				if (paneId) removePane(paneId);
			}),
		[removePane],
	);
	const actions = useMemo(() => {
		const dispatch = (
			action: Parameters<typeof dispatchAgentGroupAction>[0],
			reason: string,
		) => {
			if (selectedGroupId) dispatchAgentGroupAction(action, reason);
		};
		const groupId = selectedGroupId ?? "";
		return {
			handleAddPane: (agentKind: AgentKind) =>
				dispatch({ type: "addPane", groupId, agentKind }, "add-pane"),
			reorderPanes: (fromIndex: number, toIndex: number) =>
				dispatch(
					{ type: "reorderPanes", groupId, fromIndex, toIndex },
					"reorder-panes",
				),
			handleSetPaneAgentKind: (paneId: string, agentKind: AgentKind) =>
				dispatch(
					{ type: "setPaneAgentKind", groupId, paneId, agentKind },
					"set-pane-agent-kind",
				),
			handleDirectorySelected: (
				paneId: string,
				path: string | null,
				referencePaths?: string[],
			) =>
				dispatch(
					{ type: "directorySelected", groupId, paneId, path, referencePaths },
					"directory-selected",
				),
			selectPane: (paneId: string) =>
				dispatch({ type: "selectPane", groupId, paneId }, "select-pane"),
		};
	}, [dispatchAgentGroupAction, selectedGroupId]);
	const handleChatRef = useCallback(
		(paneId: string, handle: AgentChatHandle | null) => {
			if (handle) chatRefs.current?.set(paneId, handle);
			else chatRefs.current?.delete(paneId);
		},
		[chatRefs],
	);
	return { ...actions, handleChatRef, removePane };
}
