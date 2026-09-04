import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../design-system.ts";
import type {
	ForgeAccount,
	GithubRepo,
} from "../../../modules/repository/adapters/types.ts";
import { Button } from "../../../shared/ui/Button.tsx";
import {
	IconAgent,
	IconExternalLink,
	IconGitBranch,
	IconPlus,
	IconUser,
} from "../../../shared/ui/Icons.tsx";
import { WorkspaceEmptyState } from "../../../shared/ui/WorkspacePage.tsx";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
} from "../../../tokens.stylex.ts";

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
					<strong {...stylex.props(styles.accountName)}>
						{account.name || account.login}
					</strong>
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

export function SettingsRepoRow({
	repo,
	cloning,
	onClone,
}: {
	repo: GithubRepo;
	cloning: boolean;
	onClone: () => void;
}) {
	return (
		<div {...stylex.props(styles.repoRow)}>
			<div {...stylex.props(styles.rowText)}>
				<div {...stylex.props(styles.inlineRow)}>
					<p {...stylex.props(styles.repoName)}>{repo.full_name}</p>
					{repo.private ? (
						<span {...stylex.props(styles.privatePill)}>Private</span>
					) : null}
				</div>
				<p {...stylex.props(styles.repoDescription)}>
					{repo.description || repo.language || "No description"}
				</p>
			</div>
			<a
				href={repo.html_url}
				target="_blank"
				rel="noreferrer"
				{...stylex.props(styles.externalLink)}
				title="Open on GitHub"
			>
				<IconExternalLink size={iconSize.md} />
			</a>
			<Button
				liquid={false}
				type="button"
				onClick={onClone}
				disabled={cloning}
				variant="secondary"
				size="sm"
			>
				<IconPlus size={iconSize.md} />
				<span>{cloning ? "Cloning" : "Clone"}</span>
			</Button>
		</div>
	);
}

export function SettingsGithubEmptyState({
	onConnect,
	connecting,
}: {
	onConnect: () => void;
	connecting: boolean;
}) {
	return (
		<WorkspaceEmptyState
			icon={<IconGitBranch size={iconSize.xl} />}
			title="No GitHub accounts found"
			description="Connect with the GitHub CLI and Inferay will pick up the account automatically."
			action={
				<Button
					liquid={false}
					type="button"
					onClick={onConnect}
					disabled={connecting}
					variant="secondary"
					size="sm"
				>
					<IconAgent size={iconSize.md} />
					<span>{connecting ? "Opening GitHub…" : "Run gh auth login"}</span>
				</Button>
			}
		/>
	);
}

const styles = stylex.create({
	accountCard: {
		alignItems: "center",
		backgroundColor: color.surfaceWhite025,
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		gap: controlSize._3,
		minHeight: controlSize._16,
		padding: controlSize._3,
	},
	accountAvatar: {
		alignItems: "center",
		backgroundColor: color.controlActive,
		borderColor: color.borderStrong,
		borderRadius: radius.pill,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		display: "flex",
		flexShrink: 0,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
		height: controlSize._10,
		justifyContent: "center",
		overflow: "hidden",
		width: controlSize._10,
	},
	accountAvatarImage: {
		height: "100%",
		objectFit: "cover",
		width: "100%",
	},
	accountIdentity: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		gap: controlSize._0_5,
		minWidth: controlSize._0,
	},
	accountNameRow: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._2,
		minWidth: controlSize._0,
	},
	accountName: {
		color: color.textMain,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	accountStatus: {
		alignItems: "center",
		borderColor: color.border,
		borderRadius: radius.pill,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMuted,
		display: "inline-flex",
		flexShrink: 0,
		fontSize: font.size_1,
		gap: controlSize._1,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._1_5,
	},
	accountStatusDot: {
		backgroundColor: color.success,
		borderRadius: radius.pill,
		height: controlSize._1,
		width: controlSize._1,
	},
	accountHandle: {
		color: color.textMuted,
		fontSize: font.size_2,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	accountEmail: {
		color: color.textFaint,
		fontSize: font.size_1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	rowText: {
		minWidth: controlSize._0,
		flex: 1,
	},
	repoRow: {
		display: "flex",
		minHeight: "64px",
		alignItems: "center",
		gap: controlSize._3,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		paddingBlock: controlSize._3,
		paddingInline: controlSize._0,
	},
	inlineRow: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
	},
	repoName: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
	},
	repoDescription: {
		marginTop: controlSize._1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_0_5,
	},
	privatePill: {
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.pill,
		color: color.textMuted,
		fontSize: font.size_0,
		paddingBlock: "0.125rem",
		paddingInline: "0.375rem",
	},
	externalLink: {
		display: "flex",
		width: controlSize._7,
		height: controlSize._7,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
		backgroundColor: {
			default: color.transparent,
			":hover": color.backgroundRaised,
		},
		transitionProperty: "background-color, color",
		transitionDuration: motion.durationFast,
	},
});
