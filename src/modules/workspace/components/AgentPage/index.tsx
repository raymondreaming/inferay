import type {
	AgentWorkspaceAction,
	WorkspaceAgentKind,
	WorkspaceView,
} from "@contracts";
import type { AgentChatHandle } from "@conversation/components/AgentChatView/index.tsx";
import { chatSessionCache } from "@conversation/components/AgentChatView/useChatConnection.tsx";
import {
	FOCUS_AGENT_CHAT_COMPOSER_EVENT,
	type FocusAgentChatComposerDetail,
	listenWindowEvent,
	REMOVE_AGENT_PANE_REQUEST_EVENT,
	type RemoveAgentPaneRequestDetail,
} from "@shared/lib/dom.tsx";
import {
	clearAgentChatPaneState,
	project,
	wsClient,
} from "@shared/lib/native.tsx";
import {
	mutateAgentWorkspaceState,
	useWorkspaceState,
} from "@workspace/hooks/useWorkspaceState.tsx";
import { createEffect, createMemo, For, onSettled } from "solid-js";
import { projects } from "../../hooks/useProjects.tsx";
import { ConversationSurface } from "./ConversationSurface.tsx";

export function AgentPage() {
	const [workspace, workspaceError] = useWorkspaceState(
		() => false,
		() => false,
	);
	createEffect(
		() =>
			workspace().groups.flatMap((group) => group.panes.map((pane) => pane.id)),
		(ids) => chatSessionCache.setPaneIds(ids),
	);
	const chatRefs = new Map<string, AgentChatHandle>();
	let composerFocusFrame = 0;
	const focusChatComposer = (paneId: string) => {
		if (composerFocusFrame) {
			cancelAnimationFrame(composerFocusFrame);
		}
		let attempts = 0;
		const focusComposer = () => {
			const handle = chatRefs.get(paneId);
			if (handle) {
				composerFocusFrame = 0;
				const activeElement = document.activeElement;
				const activePaneId =
					activeElement instanceof Element
						? activeElement.closest<HTMLElement>("[data-agent-grid-pane-id]")
								?.dataset.agentGridPaneId
						: null;
				const targetControlIsFocused =
					activePaneId === paneId &&
					activeElement instanceof Element &&
					!!activeElement.closest(
						"button, input, textarea, select, a, [contenteditable='true']",
					);
				if (!targetControlIsFocused) {
					handle.focusInput(true);
					handle.highlightComposer();
				}
				return;
			}
			attempts += 1;
			if (attempts < 12) {
				composerFocusFrame = requestAnimationFrame(focusComposer);
			} else {
				composerFocusFrame = 0;
			}
		};
		composerFocusFrame = requestAnimationFrame(focusComposer);
	};
	createEffect(
		() => [focusChatComposer],
		() => {
			const stopListening = listenWindowEvent(
				FOCUS_AGENT_CHAT_COMPOSER_EVENT,
				(event) => {
					const { paneId } = (
						event as CustomEvent<FocusAgentChatComposerDetail>
					).detail;
					focusChatComposer(paneId);
				},
			);
			return () => {
				stopListening();
				if (composerFocusFrame) {
					cancelAnimationFrame(composerFocusFrame);
				}
			};
		},
	);
	const activeViewKey = createMemo(() =>
		JSON.stringify([workspace().selectedGroupId ?? "", projects.selectedId()]),
	);
	const retainedViews = createMemo<WorkspaceView[]>((previous) =>
		project("retainedWorkspaces", {
			groups: workspace().groups,
			scopeId: projects.selectedId(),
			previous: previous?.map((view) => view.key) ?? [],
			activeKey: activeViewKey(),
		}),
	);
	const cleanupPane = (paneId: string) => {
		wsClient.send({
			type: "chat:destroy",
			paneId,
		});
		chatRefs.delete(paneId);
		clearAgentChatPaneState(paneId);
	};
	const dispatch = (action: AgentWorkspaceAction) => {
		void mutateAgentWorkspaceState(action);
	};
	const actions = {
		removePane: (paneId: string) => {
			cleanupPane(paneId);
			dispatch({ type: "removePane", paneId });
		},
		selectPane: (paneId: string) => dispatch({ type: "selectPane", paneId }),
		handleSetPaneAgentKind: (paneId: string, agentKind: WorkspaceAgentKind) =>
			dispatch({ type: "changePaneAgentKind", paneId, agentKind }),
		handleDirectorySelected: (
			paneId: string,
			path: string | null,
			referencePaths?: string[],
		) => dispatch({ type: "directorySelected", paneId, path, referencePaths }),
		handleChatRef: (id: string, handle: AgentChatHandle | null) => {
			handle ? chatRefs.set(id, handle) : chatRefs.delete(id);
		},
	};
	onSettled(() =>
		listenWindowEvent(REMOVE_AGENT_PANE_REQUEST_EVENT, (event) => {
			const paneId = (event as CustomEvent<RemoveAgentPaneRequestDetail>).detail
				?.paneId;
			if (paneId) actions.removePane(paneId);
		}),
	);

	return (
		<>
			{workspaceError() ? <div role="alert">{workspaceError()}</div> : null}
			<For each={retainedViews()} keyed={(view) => view.key}>
				{(view) => (
					<ConversationSurface
						view={view()}
						group={workspace().groups[view().groupIndex]}
						active={view().key === activeViewKey()}
						actions={actions}
						onFocusPane={focusChatComposer}
					/>
				)}
			</For>
		</>
	);
}
