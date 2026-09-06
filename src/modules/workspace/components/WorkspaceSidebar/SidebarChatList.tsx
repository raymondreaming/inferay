import * as stylex from "@octanejs/stylex";
import type { SidebarWorkspaceState } from "../../model/workspace-model.ts";
import {
	getVisibleRepositoryEntries,
	projectRepositoryWorkspaces,
} from "../../model/workspace-model.ts";
import { PaneSummaryItem } from "./PaneSummaryItem.tsx";
import { styles } from "./styles.ts";

export function SidebarChatList({
	workspaces,
	onSelectPane,
}: {
	workspaces: SidebarWorkspaceState;
	onSelectPane: (groupId: string, paneId: string) => void;
}) {
	const repositoryProjection = projectRepositoryWorkspaces(workspaces);
	const entries = getVisibleRepositoryEntries(repositoryProjection);

	return (
		<div {...stylex.props(styles.workspacePaneList)}>
			{entries.length > 0 ? (
				entries.map(({ groupId, pane }) => (
					<PaneSummaryItem
						key={pane.id}
						pane={pane}
						isActive={
							groupId === workspaces.selectedGroupId &&
							pane.id ===
								workspaces.groups.find((group) => group.id === groupId)
									?.selectedPaneId
						}
						onClick={() => onSelectPane(groupId, pane.id)}
					/>
				))
			) : (
				<div {...stylex.props(styles.repositoryEmptyState)}>
					No chats in this repository yet.
				</div>
			)}
		</div>
	);
}
