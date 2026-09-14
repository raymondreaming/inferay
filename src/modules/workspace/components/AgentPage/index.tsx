import type {
	AgentWorkspaceAction,
	WorkspaceAgentKind,
	WorkspaceView,
} from "@contracts";
import type { AgentChatHandle } from "@conversation/components/AgentChatView/index.tsx";
import { chatSessionCache } from "@conversation/components/AgentChatView/useChatConnection.tsx";
import {
	getThemeById,
	loadAppThemeId,
} from "@settings/hooks/useAppAppearance.tsx";
import {
	FOCUS_AGENT_CHAT_COMPOSER_EVENT,
	type FocusAgentChatComposerDetail,
	hasId,
	listenWindowEvent,
	REMOVE_AGENT_PANE_REQUEST_EVENT,
	type RemoveAgentPaneRequestDetail,
} from "@shared/lib/dom.tsx";
import {
	APP_THEME_STORAGE_KEY,
	CLIENT_STORAGE_CHANGED_EVENT,
	clearAgentChatPaneState,
	listenAgentLayoutMode,
	loadAgentLayoutMode,
	project,
	wsClient,
} from "@shared/lib/native.tsx";
import {
	mutateAgentWorkspaceState,
	useWorkspaceState,
} from "@workspace/hooks/useWorkspaceState.tsx";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	merge,
	onSettled,
} from "solid-js";
import { RepositorySurface } from "./RepositorySurface.tsx";

type AgentPaneActionsArgs = {
	readonly chatRefs: Map<string, AgentChatHandle>;
	readonly cleanupPane: (paneId: string) => void;
	readonly dispatchAgentGroupAction: (action: AgentWorkspaceAction) => void;
	readonly groups: import("@contracts").AgentSavedState["groups"];
	readonly selectedGroupId: string | null;
};

function useAgentPaneActions(options: () => AgentPaneActionsArgs) {
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

export function AgentPage() {
	const [layoutMode, setLayoutMode] = createSignal(loadAgentLayoutMode);
	onSettled(() => {
		return listenAgentLayoutMode(setLayoutMode);
	});
	const [workspace, setWorkspace, workspaceError] = useWorkspaceState(
		() => false,
		() => false,
	);
	createEffect(
		() =>
			workspace().groups.flatMap((group) => group.panes.map((pane) => pane.id)),
		(ids) => chatSessionCache.setPaneIds(ids),
	);
	const [themeId, setThemeId] = createSignal(loadAppThemeId);
	onSettled(() => {
		return listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
			const key = (
				event as CustomEvent<{
					key?: string;
				}>
			).detail?.key;
			if (key !== APP_THEME_STORAGE_KEY) return;
			setThemeId(loadAppThemeId());
		});
	});
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
	const theme = createMemo(() => getThemeById(themeId()));
	const activeViewKey = createMemo(() =>
		JSON.stringify([
			workspace().selectedGroupId ?? "",
			workspace().repositories.activePath,
		]),
	);
	const retainedViews = createMemo<WorkspaceView[]>((previous) =>
		project("retainedWorkspaces", {
			groups: workspace().groups,
			repositories: workspace().repositories,
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
	const dispatchAgentGroupAction = (action: AgentWorkspaceAction) => {
		if (action.type === "reorderPanes") {
			setWorkspace((current) => ({
				...current,
				groups: current.groups.map((group) => {
					if (group.id !== action.groupId) return group;
					const panes = [...group.panes];
					const [pane] = panes.splice(action.fromIndex, 1);
					if (pane) panes.splice(action.toIndex, 0, pane);
					return {
						...group,
						panes,
					};
				}),
			}));
		}
		void mutateAgentWorkspaceState(action);
	};
	const _source2 = useAgentPaneActions(() => {
		const _sourceValue2 = workspace();
		return {
			chatRefs,
			cleanupPane,
			dispatchAgentGroupAction,
			groups: _sourceValue2.groups,
			selectedGroupId: _sourceValue2.selectedGroupId,
		};
	});
	return (
		<>
			{workspaceError() ? <div role="alert">{workspaceError()}</div> : null}
			<For each={retainedViews()} keyed={(view) => view.key}>
				{(view) => (
					<RepositorySurface
						view={view()}
						group={workspace().groups[view().groupIndex]!}
						active={view().key === activeViewKey()}
						layoutMode={layoutMode()}
						theme={theme()}
						actions={_source2}
						onFocusPane={focusChatComposer}
					/>
				)}
			</For>
		</>
	);
}
