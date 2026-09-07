import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { openSettingsModal } from "../../../../shared/lib/data.ts";
import { IconUser } from "../../../../shared/ui/Icons/index.tsx";
import type { useForgeAccounts } from "../../../repository/hooks/useForgeAccounts.tsx";
import { styles } from "./styles.ts";

export function SidebarAccountButton({
	githubAccount,
}: {
	githubAccount: ReturnType<typeof useForgeAccounts>["data"][number] | null;
}) {
	return (
		<button
			type="button"
			onClick={() => openSettingsModal("github")}
			{...stylex.props(styles.sidebarAccount)}
			title="Account settings"
		>
			{githubAccount?.avatarUrl ? (
				<img
					src={githubAccount.avatarUrl}
					alt=""
					{...stylex.props(styles.sidebarAvatar)}
				/>
			) : (
				<span {...stylex.props(styles.sidebarAvatarFallback)}>
					<IconUser size={iconSize.sm} />
				</span>
			)}
			<span {...stylex.props(styles.sidebarUsername)}>
				{githubAccount?.login || "GitHub account"}
			</span>
		</button>
	);
}
