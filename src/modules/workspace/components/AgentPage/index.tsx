import type { AgentWorkspaceAction, WorkspaceView } from "@contracts";
import { chatSessionCache } from "@conversation/components/AgentChatView/chatSessionCache.ts";
import type { AgentChatHandle } from "@conversation/components/AgentChatView/index.tsx";
import {
	getThemeById,
	loadAppThemeId,
} from "@settings/hooks/useAppAppearance.tsx";
import {
	FOCUS_AGENT_CHAT_COMPOSER_EVENT,
	type FocusAgentChatComposerDetail,
	listenWindowEvent,
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
	onSettled,
} from "solid-js";
import { RepositorySurface } from "./RepositorySurface.tsx";
import { useAgentPaneActions } from "./useAgentPaneActions.ts";
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
