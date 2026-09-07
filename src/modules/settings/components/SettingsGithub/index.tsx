import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import type { ForgeAccount } from "../../../../../build/presentation/contracts/ForgeAccount.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { ariaValue } from "../../../../shared/lib/dom.tsx";
import {
	IconExternalLink,
	IconUser,
} from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";
export function SettingsGithubAccount(_props: { account: ForgeAccount }) {
	const fallback = createMemo(() =>
		_props.account.login.slice(0, 2).toLocaleUpperCase(),
	);
	return (
		<div
			data-settings-github-account={_props.account.login}
			{...stylex.attrs(styles.accountCard)}
		>
			<div {...stylex.attrs(styles.accountAvatar)}>
				{_props.account.avatarUrl ? (
					<img
						src={_props.account.avatarUrl}
						alt=""
						{...stylex.attrs(styles.accountAvatarImage)}
					/>
				) : fallback() ? (
					fallback()
				) : (
					<IconUser size={iconSize.lg} />
				)}
			</div>
			<div {...stylex.attrs(styles.accountIdentity)}>
				<div {...stylex.attrs(styles.accountNameRow)}>
					<strong {...stylex.attrs(styles.accountName)}>
						{_props.account.login}
					</strong>
					<span {...stylex.attrs(styles.accountStatus)}>
						<span
							aria-hidden="true"
							{...stylex.attrs(styles.accountStatusDot)}
						/>
						{_props.account.active ? "Active" : "Connected"}
					</span>
				</div>
				<span {...stylex.attrs(styles.accountHandle)}>
					@{_props.account.login} · {_props.account.host}
				</span>
				{_props.account.email ? (
					<span {...stylex.attrs(styles.accountEmail)}>
						{_props.account.email}
					</span>
				) : null}
			</div>
			<a
				href={`https://${_props.account.host}/${_props.account.login}`}
				target="_blank"
				rel="noreferrer"
				title={`Open @${_props.account.login} on GitHub`}
				aria-label={ariaValue(`Open @${_props.account.login} on GitHub`)}
				{...stylex.attrs(styles.externalLink)}
			>
				<IconExternalLink size={iconSize.md} />
			</a>
		</div>
	);
}
export { SettingsGithubEmptyState } from "./SettingsGithubEmptyState.tsx";
export { SettingsRepoRow } from "./SettingsRepoRow.tsx";
