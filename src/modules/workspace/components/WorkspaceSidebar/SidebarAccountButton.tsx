import * as stylex from "@stylexjs/stylex";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { openSettingsModal } from "../../../../shared/lib/dom.tsx";
import { IconUser } from "../../../../shared/ui/Icons/index.tsx";
import type { useForgeAccounts } from "../../../repository/hooks/useForgeAccounts.tsx";
import { styles } from "./styles.ts";
export function SidebarAccountButton(_props: {
	githubAccount: ReturnType<typeof useForgeAccounts>["data"][number] | null;
}) {
	return (
		<button
			type="button"
			onClick={() => openSettingsModal("github")}
			{...stylex.attrs(styles.sidebarAccount)}
			title="Account settings"
		>
			{_props.githubAccount?.avatarUrl ? (
				<img
					src={_props.githubAccount.avatarUrl}
					alt=""
					{...stylex.attrs(styles.sidebarAvatar)}
				/>
			) : (
				<span {...stylex.attrs(styles.sidebarAvatarFallback)}>
					<IconUser size={iconSize.sm} />
				</span>
			)}
			<span {...stylex.attrs(styles.sidebarUsername)}>
				{_props.githubAccount?.login || "GitHub account"}
			</span>
		</button>
	);
}
