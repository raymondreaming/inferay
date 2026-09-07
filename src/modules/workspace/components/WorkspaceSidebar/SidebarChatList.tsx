import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import type { SidebarWorkspaceState } from "../../hooks/useWorkspaceState.tsx";
import { PaneSummaryItem } from "./PaneSummaryItem.tsx";
import { styles } from "./styles.ts";
export function SidebarChatList(_props: {
	workspaces: SidebarWorkspaceState;
	onSelectPane: (groupId: string, paneId: string) => void;
}) {
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
						isActive={
							entry().groupId === _props.workspaces.selectedGroupId &&
							entry().pane.id ===
								_props.workspaces.groups.find(
									(group) => group.id === entry().groupId,
								)?.selectedPaneId
						}
						onClick={() =>
							_props.onSelectPane(entry().groupId, entry().pane.id)
						}
					/>
				)}
			</For>
		</div>
	);
}
