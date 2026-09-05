import { useCallback, useEffect } from "octane";
import { hasId } from "../../../../shared/lib/data.ts";
import { listenWindowEvent } from "../../../../shared/lib/react-events.ts";
import type { AgentChatHandle } from "../../../conversation/components/AgentChatView/index.tsx";
import {
	type AgentKind,
	createAgentPane,
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
	withSelectedGroup,
}: AgentPaneActionsArgs) {
	const handleAddPane = useCallback(
		(agentKind: AgentKind) =>
			withSelectedGroup((groupId) => {
				const pane = createAgentPane(agentKind, undefined, true);
				dispatchAgentGroupAction(
					{
						type: "addPane",
						groupId,
						pane,
					},
					"add-pane",
				);
			}),
		[dispatchAgentGroupAction, withSelectedGroup],
	);
	const removePane = useCallback(
		(paneId: string, force?: boolean) => {
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
					force,
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
	const reorderPanes = useCallback(
		(fromIndex: number, toIndex: number) =>
			withSelectedGroup((groupId) =>
				dispatchAgentGroupAction(
					{
						type: "reorderPanes",
						groupId,
						fromIndex,
						toIndex,
					},
					"reorder-panes",
				),
			),
		[dispatchAgentGroupAction, withSelectedGroup],
	);
	const handleSetPaneAgentKind = useCallback(
		(paneId: string, agentKind: AgentKind) =>
			withSelectedGroup((groupId) =>
				dispatchAgentGroupAction(
					{
						type: "setPaneAgentKind",
						groupId,
						paneId,
						agentKind,
					},
					"set-pane-agent-kind",
				),
			),
		[dispatchAgentGroupAction, withSelectedGroup],
	);
	const handleDirectorySelected = useCallback(
		(paneId: string, path: string | null, referencePaths?: string[]) => {
			withSelectedGroup((groupId) =>
				dispatchAgentGroupAction(
					{
						type: "directorySelected",
						groupId,
						paneId,
						path,
						referencePaths,
					},
					"directory-selected",
				),
			);
		},
		[dispatchAgentGroupAction, withSelectedGroup],
	);
	const selectPane = useCallback(
		(paneId: string) =>
			withSelectedGroup((groupId) =>
				dispatchAgentGroupAction(
					{ type: "selectPane", groupId, paneId },
					"select-pane",
				),
			),
		[dispatchAgentGroupAction, withSelectedGroup],
	);
	const handleChatRef = useCallback(
		(paneId: string, handle: AgentChatHandle | null) => {
			if (handle) chatRefs.current?.set(paneId, handle);
			else chatRefs.current?.delete(paneId);
		},
		[chatRefs],
	);
	return {
		handleAddPane,
		handleChatRef,
		handleDirectorySelected,
		handleSetPaneAgentKind,
		removePane,
		reorderPanes,
		selectPane,
	};
}
