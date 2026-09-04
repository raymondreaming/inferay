import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../design-system.ts";
import type { GithubRepo } from "../../../modules/repository/adapters/types.ts";
import { Button } from "../../../shared/ui/Button.tsx";
import {
	IconAgent,
	IconExternalLink,
	IconGitBranch,
	IconPlus,
} from "../../../shared/ui/Icons.tsx";
import { WorkspaceEmptyState } from "../../../shared/ui/WorkspacePage.tsx";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
} from "../../../tokens.stylex.ts";

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
}: {
	onConnect: () => void;
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
					variant="secondary"
					size="sm"
				>
					<IconAgent size={iconSize.md} />
					<span>Run gh auth login</span>
				</Button>
			}
		/>
	);
}

const styles = stylex.create({
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
