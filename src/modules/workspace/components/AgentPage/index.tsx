import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	merge,
	onSettled,
	Show,
} from "solid-js";
import type { AgentSavedState } from "../../../../../build/presentation/contracts/AgentSavedState.ts";
import type { WorkspaceAgentKind } from "../../../../../build/presentation/contracts/WorkspaceAgentKind.ts";
import {
	getThemeById,
	loadAppThemeId,
} from "../../../../app/hooks/useAppAppearance.tsx";
import {
	FOCUS_AGENT_CHAT_COMPOSER_EVENT,
	type FocusAgentChatComposerDetail,
	hasId,
	listenWindowEvent,
	type MutableRef,
	REMOVE_AGENT_PANE_REQUEST_EVENT,
	type RemoveAgentPaneRequestDetail,
} from "../../../../shared/lib/dom.tsx";
import {
	APP_THEME_STORAGE_KEY,
	CLIENT_STORAGE_CHANGED_EVENT,
	clearAgentChatPaneState,
	listenAgentLayoutMode,
	loadAgentLayoutMode,
	setAgentLayoutMode,
	wsClient,
} from "../../../../shared/lib/native.tsx";
import type { AgentChatHandle } from "../../../conversation/components/AgentChatView/index.tsx";
import { useRepositoryWorkbench } from "../../../workbench/hooks/useRepositoryWorkbench.tsx";
import {
	type AgentGroupsAction,
	mutateAgentWorkspaceState,
	useWorkspaceState,
} from "../../hooks/useWorkspaceState.tsx";
import { DEFAULT_ROWS, WorkspaceCanvas } from "../WorkspaceCanvas/index.tsx";
import { AgentMainSurface } from "./AgentMainSurface.tsx";
export type AgentPaneActionsArgs = {
	readonly chatRefs: MutableRef<Map<string, AgentChatHandle> | null>;
	readonly cleanupPane: (paneId: string) => void;
	readonly dispatchAgentGroupAction: (action: AgentGroupsAction) => void;
	readonly groups: AgentSavedState["groups"];
	readonly selectedGroupId: string | null;
};
export function AgentPage() {
	const [layoutMode, setLayoutMode] = createSignal(loadAgentLayoutMode);
	onSettled(() => {
		return listenAgentLayoutMode(setLayoutMode);
	});
	createEffect(
		() => [layoutMode()],
		() => {
			setAgentLayoutMode(layoutMode());
		},
	);
	const [workspace, setWorkspace, workspaceError] = useWorkspaceState(
		() => false,
		() => false,
	);
	const _source = createMemo(() => workspace());
	const [showSettings, setShowSettings] = createSignal(false);
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
	const chatRefs = {
		current: null,
	} as {
		current: Map<string, AgentChatHandle> | null;
	};
	if (chatRefs.current === null) {
		chatRefs.current = new Map();
	}
	const composerFocusFrameRef = {
		current: 0,
	};
	const focusChatComposer = (paneId: string) => {
		if (composerFocusFrameRef.current) {
			cancelAnimationFrame(composerFocusFrameRef.current);
		}
		let attempts = 0;
		const focusComposer = () => {
			const handle = chatRefs.current?.get(paneId);
			if (handle) {
				composerFocusFrameRef.current = 0;
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
				composerFocusFrameRef.current = requestAnimationFrame(focusComposer);
			} else {
				composerFocusFrameRef.current = 0;
			}
		};
		composerFocusFrameRef.current = requestAnimationFrame(focusComposer);
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
				if (composerFocusFrameRef.current) {
					cancelAnimationFrame(composerFocusFrameRef.current);
				}
			};
		},
	);
	const theme = createMemo(() => getThemeById(themeId()));
	const currentGroup = createMemo(() => {
		const _sourceValue = _source();
		return _sourceValue.groups.find(
			hasId.bind(null, _sourceValue.selectedGroupId),
		);
	});
	const selectedPane = createMemo(
		() =>
			currentGroup()?.panes.find(
				(pane) => pane.id === currentGroup()?.selectedPaneId,
			) ?? null,
	);
	const currentRepositoryPanes = createMemo(() => {
		const visible = new Set(
			workspace()
				.repositories.visibleEntries.filter(
					(entry) => entry.groupId === currentGroup()?.id,
				)
				.map((entry) => entry.pane.id),
		);
		return currentGroup()?.panes.filter((pane) => visible.has(pane.id)) ?? [];
	});
	const repositoryWorkbench = useRepositoryWorkbench(() => ({
		active: true,
		cwd: selectedPane()?.cwd,
		workspaceId:
			workspace().repositories.activeWorkspace?.cwd ??
			currentGroup()?.id ??
			"default",
	}));
	const cleanupPane = (paneId: string) => {
		wsClient.send({
			type: "chat:destroy",
			paneId,
		});
		chatRefs.current?.delete(paneId);
		clearAgentChatPaneState(paneId);
	};
	const dispatchAgentGroupAction = (action: AgentGroupsAction) => {
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
	onSettled(() => {
		return listenWindowEvent("agent-open-theme-panel", () =>
			setShowSettings(true),
		);
	});
	const _source2 = useAgentPaneActions(() => {
		const _sourceValue2 = _source();
		return {
			chatRefs,
			cleanupPane,
			dispatchAgentGroupAction,
			groups: _sourceValue2.groups,
			selectedGroupId: _sourceValue2.selectedGroupId,
		};
	});
	const selectChatPane = (paneId: string) => {
		const paneCwd = currentGroup()?.panes.find(
			(pane) => pane.id === paneId,
		)?.cwd;
		repositoryWorkbench.focusWorkbench(paneCwd);
		_source2.selectPane(paneId);
	};
	const agentGrid = (
		<Show when={currentGroup()?.id} keyed>
			{(groupId) => (
				<WorkspaceCanvas
					active
					panes={
						repositoryWorkbench.zenMode && selectedPane()
							? [selectedPane()!]
							: currentRepositoryPanes()
					}
					selectedPaneId={currentGroup()?.selectedPaneId ?? null}
					columns={
						repositoryWorkbench.zenMode ? 1 : (currentGroup()?.columns ?? 1)
					}
					rows={
						repositoryWorkbench.zenMode
							? 1
							: (currentGroup()?.rows ?? DEFAULT_ROWS)
					}
					layoutMode={layoutMode()}
					theme={theme()}
					onSelectPane={selectChatPane}
					onFocusPane={focusChatComposer}
					onClosePane={_source2.removePane}
					onDirectorySelect={_source2.handleDirectorySelected}
					onDirectoryCancel={_source2.removePane}
					onChatRef={_source2.handleChatRef}
					onReorderPanes={_source2.reorderPanes}
					onAddPane={_source2.handleAddPane}
					onSetPaneAgentKind={_source2.handleSetPaneAgentKind}
					workspaceId={groupId}
					auxiliaryPanels={repositoryWorkbench.auxiliaryPanels}
				/>
			)}
		</Show>
	);
	const hasCurrentPanes = createMemo(() => currentRepositoryPanes().length > 0);
	return (
		<>
			{workspaceError() ? <div role="alert">{workspaceError()}</div> : null}
			<AgentMainSurface
				chatDiffPanel={repositoryWorkbench.diffPanel}
				chatSidebar={repositoryWorkbench.sidebar}
				chatZenMode={repositoryWorkbench.zenMode}
				hasCurrentPanes={hasCurrentPanes()}
				onThemeChange={setThemeId}
				setShowSettings={setShowSettings}
				showSettings={showSettings()}
				agentGrid={agentGrid}
				themeId={themeId()}
			/>
		</>
	);
}
export function useAgentPaneActions(_options: Accessor<AgentPaneActionsArgs>) {
	const removePane = (paneId: string) => {
		const _optionsValue = _options();
		const group =
			_optionsValue.groups.find((g) =>
				g.panes.some(hasId.bind(null, paneId)),
			) ??
			_optionsValue.groups.find(
				hasId.bind(null, _optionsValue.selectedGroupId),
			);
		if (group) {
			_optionsValue.cleanupPane(paneId);
			_optionsValue.dispatchAgentGroupAction({
				type: "removePane",
				groupId: group.id,
				paneId,
			});
		}
	};
	createEffect(
		() => [removePane, _options()],
		() => {
			return listenWindowEvent(REMOVE_AGENT_PANE_REQUEST_EVENT, (event) => {
				const id = (event as CustomEvent<RemoveAgentPaneRequestDetail>).detail
					?.paneId;
				if (id) removePane(id);
			});
		},
	);
	const actions = createMemo(() => {
		const send = (a: AgentGroupsAction) => {
				const _optionsValue2 = _options();
				if (_optionsValue2.selectedGroupId)
					_optionsValue2.dispatchAgentGroupAction(a);
			},
			groupId = _options().selectedGroupId ?? "";
		return {
			handleAddPane: (agentKind: WorkspaceAgentKind) =>
				send({
					type: "addPane",
					groupId,
					agentKind,
				}),
			reorderPanes: (fromIndex: number, toIndex: number) =>
				send({
					type: "reorderPanes",
					groupId,
					fromIndex,
					toIndex,
				}),
			handleSetPaneAgentKind: (paneId: string, agentKind: WorkspaceAgentKind) =>
				send({
					type: "setPaneAgentKind",
					groupId,
					paneId,
					agentKind,
				}),
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
				send({
					type: "selectPane",
					groupId,
					paneId,
				}),
		};
	});
	const handleChatRef = (id: string, handle: AgentChatHandle | null) => {
		const _optionsValue3 = _options();
		handle
			? _optionsValue3.chatRefs.current?.set(id, handle)
			: _optionsValue3.chatRefs.current?.delete(id);
	};
	return merge(
		() => {
			return actions();
		},
		{
			get handleChatRef() {
				return handleChatRef;
			},
			get removePane() {
				return removePane;
			},
		},
	);
}
