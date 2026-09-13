import * as stylex from "@stylexjs/stylex";
import { createSignal, For, onSettled } from "solid-js";
import type { SidebarWorkspaceState } from "../../hooks/useWorkspaceState.tsx";
import { PaneSummaryItem } from "./PaneSummaryItem.tsx";
import { styles } from "./styles.ts";
export function SidebarChatList(_props: {
	workspaces: SidebarWorkspaceState;
	onSelectPane: (groupId: string, paneId: string) => void;
}) {
	const [activePaneId, setActivePaneId] = createSignal<string | null>(null);
	onSettled(() => {
		const activate = (event: Event) => {
			const target = event.target;
			setActivePaneId(
				target instanceof Element
					? (target.closest<HTMLElement>("[data-chat-pane-id]")?.dataset
							.chatPaneId ?? null)
					: null,
			);
		};
		const clear = () => setActivePaneId(null);
		document.addEventListener("pointerdown", activate, true);
		document.addEventListener("focusin", activate, true);
		window.addEventListener("blur", clear);
		document.addEventListener("visibilitychange", clear);
		return () => {
			document.removeEventListener("pointerdown", activate, true);
			document.removeEventListener("focusin", activate, true);
			window.removeEventListener("blur", clear);
			document.removeEventListener("visibilitychange", clear);
		};
	});
	return (
		<div {...stylex.attrs(styles.workspacePaneList)}>
			<For
				each={_props.workspaces.repositories.visibleEntries}
				keyed={(entry) => `${entry.groupId}:${entry.pane.id}`}
				fallback={
					<div {...stylex.attrs(styles.repositoryEmptyState)}>
						No chats in this repository yet.
					</div>
				}
			>
				{(entry) => (
					<PaneSummaryItem
						pane={entry().pane}
						isActive={entry().pane.id === activePaneId()}
						onClick={() =>
							_props.onSelectPane(entry().groupId, entry().pane.id)
						}
					/>
				)}
			</For>
		</div>
	);
}
