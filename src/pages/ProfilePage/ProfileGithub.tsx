import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import {
	IconExternalLink,
	IconGitBranch,
	IconPlus,
	IconTerminal,
} from "../../components/ui/Icons.tsx";
import { WorkspaceEmptyState } from "../../components/ui/WorkspacePage.tsx";
import type { GithubRepo } from "../../features/forge/types.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";

export function ProfileRepoRow({
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
				<IconExternalLink size={12} />
			</a>
			<Button
				type="button"
				onClick={onClone}
				disabled={cloning}
				variant="primary"
				size="sm"
			>
				<IconPlus size={12} />
				<span>{cloning ? "Cloning" : "Clone"}</span>
			</Button>
		</div>
	);
}

export function ProfileGithubEmptyState({
	onConnect,
}: {
	onConnect: () => void;
}) {
	return (
		<WorkspaceEmptyState
			icon={<IconGitBranch size={16} />}
			title="No GitHub accounts found"
			description="Connect with the GitHub CLI and Inferay will pick up the account automatically."
			action={
				<Button type="button" onClick={onConnect} variant="primary" size="sm">
					<IconTerminal size={12} />
					<span>Run gh auth login</span>
				</Button>
			}
		/>
	);
}

const styles = stylex.create({
	rowText: {
		minWidth: 0,
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
		paddingInline: controlSize._4,
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
		fontSize: "0.5rem",
	},
	privatePill: {
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: "999px",
		color: color.textMuted,
		fontSize: "0.4375rem",
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
		borderRadius: "0.375rem",
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
		backgroundColor: {
			default: "transparent",
			":hover": color.backgroundRaised,
		},
		transitionProperty: "background-color, color",
		transitionDuration: "120ms",
	},
});
