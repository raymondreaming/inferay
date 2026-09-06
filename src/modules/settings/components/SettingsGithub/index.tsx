import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import {
	IconExternalLink,
	IconUser,
} from "../../../../shared/ui/Icons/index.tsx";
import type { ForgeAccount } from "../../../repository/model/types.ts";
import { styles } from "./styles.ts";
export function SettingsGithubAccount({ account }: { account: ForgeAccount }) {
	const fallback = account.login.slice(0, 2).toLocaleUpperCase();
	return (
		<div
			data-settings-github-account={account.login}
			{...stylex.props(styles.accountCard)}
		>
			<div {...stylex.props(styles.accountAvatar)}>
				{account.avatarUrl ? (
					<img
						src={account.avatarUrl}
						alt=""
						{...stylex.props(styles.accountAvatarImage)}
					/>
				) : fallback ? (
					fallback
				) : (
					<IconUser size={iconSize.lg} />
				)}
			</div>
			<div {...stylex.props(styles.accountIdentity)}>
				<div {...stylex.props(styles.accountNameRow)}>
					<strong {...stylex.props(styles.accountName)}>{account.login}</strong>
					<span {...stylex.props(styles.accountStatus)}>
						<span
							aria-hidden="true"
							{...stylex.props(styles.accountStatusDot)}
						/>
						{account.active ? "Active" : "Connected"}
					</span>
				</div>
				<span {...stylex.props(styles.accountHandle)}>
					@{account.login} · {account.host}
				</span>
				{account.email ? (
					<span {...stylex.props(styles.accountEmail)}>{account.email}</span>
				) : null}
			</div>
			<a
				href={`https://${account.host}/${account.login}`}
				target="_blank"
				rel="noreferrer"
				title={`Open @${account.login} on GitHub`}
				aria-label={`Open @${account.login} on GitHub`}
				{...stylex.props(styles.externalLink)}
			>
				<IconExternalLink size={iconSize.md} />
			</a>
		</div>
	);
}
export { SettingsGithubEmptyState } from "./SettingsGithubEmptyState.tsx";
export { SettingsRepoRow } from "./SettingsRepoRow.tsx";
