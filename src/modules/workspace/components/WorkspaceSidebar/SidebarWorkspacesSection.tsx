import { iconSize } from "@design-system/styles.stylex.ts";
import { dispatchCreateAgentChat } from "@shared/lib/dom.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { IconPlus } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import type { SidebarWorkspaceState } from "../../hooks/useWorkspaceState.tsx";
import { SidebarChatList } from "./SidebarChatList.tsx";
import { styles } from "./styles.ts";

export function SidebarWorkspacesSection(props: {
	workspaces: SidebarWorkspaceState;
	onSelectPane: (groupId: string, paneId: string) => void;
}) {
	return (
		<div {...stylex.attrs(styles.workspaceSection)}>
			<div {...stylex.attrs(styles.workspaceListScroll)}>
				<div {...stylex.attrs(styles.workspaceSectionHeader)}>
					<span {...stylex.attrs(styles.workspaceSectionTitle)}>Chats</span>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => dispatchCreateAgentChat()}
					>
						<IconPlus size={iconSize.md} /> New chat
					</Button>
				</div>
				<SidebarChatList
					workspaces={props.workspaces}
					onSelectPane={props.onSelectPane}
				/>
			</div>
		</div>
	);
}
