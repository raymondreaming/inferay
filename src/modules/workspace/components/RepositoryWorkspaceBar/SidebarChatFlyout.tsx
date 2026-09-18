import type { RepositoryWorkspaceEntry } from "@contracts";
import { surfaceStyles } from "@design-system/styles.stylex.ts";
import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import { PaneSummaryItem } from "../WorkspaceSidebar/PaneSummaryItem.tsx";
import { styles } from "./styles.ts";

/** Reaches the repository's chats while the workspace sidebar stays closed. */
export function SidebarChatFlyout(props: {
	entries: RepositoryWorkspaceEntry[];
	activePaneId: string | null;
	onSelectPane: (groupId: string, paneId: string) => void;
}) {
	return (
		<div {...stylex.attrs(styles.chatFlyoutAnchor)}>
			<div
				role="menu"
				aria-label="Chats in this repository"
				{...stylex.attrs(surfaceStyles.overlay, styles.chatFlyout)}
			>
				<For
					each={props.entries}
					keyed={(entry) => `${entry.groupId}:${entry.pane.id}`}
					fallback={
						<span {...stylex.attrs(styles.chatFlyoutEmpty)}>
							No chats in this repository yet.
						</span>
					}
				>
					{(entry) => (
						<PaneSummaryItem
							pane={entry().pane}
							isActive={entry().pane.id === props.activePaneId}
							onClick={() =>
								props.onSelectPane(entry().groupId, entry().pane.id)
							}
						/>
					)}
				</For>
			</div>
		</div>
	);
}
