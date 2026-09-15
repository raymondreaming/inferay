import type { GraphCommit } from "@contracts";
import { domStyle } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
export function CommitMessageCell(_props: {
	commit: GraphCommit;
	width: number;
	isWip: boolean;
}) {
	return (
		<div
			{...stylex.attrs(styles.messageCell)}
			style={domStyle(inlineStyles.getCommitRowMessageCellStyle(_props.width))}
		>
			{_props.isWip ? (
				<span data-graph-wip-summary {...stylex.attrs(styles.commitMessage)}>
					WIP
					{_props.commit.changeSummary &&
						` · ${_props.commit.changeSummary.files} file${_props.commit.changeSummary.files === 1 ? "" : "s"}`}
				</span>
			) : (
				<>
					{_props.commit.pullRequest ? (
						<a
							href={_props.commit.pullRequest.url}
							target="_blank"
							rel="noopener noreferrer"
							onClick={(event) => event.stopPropagation()}
							title={`PR #${_props.commit.pullRequest.number} merged into ${_props.commit.pullRequest.baseBranch} as ${_props.commit.pullRequest.mergeHash.slice(0, 8)}. ${
								_props.commit.pullRequest.localBranchDiffers
									? "This local branch differs from the merged PR tip. Its current work is not confirmed as included."
									: "Graph lines show Git parent relationships. A merged PR does not always create a connecting merge line."
							}`}
							{...stylex.attrs(
								styles.pullRequestBadge,
								_props.commit.pullRequest.localBranchDiffers &&
									styles.pullRequestDiffers,
							)}
						>
							PR #{_props.commit.pullRequest.number}
							{_props.commit.pullRequest.localBranchDiffers
								? " merged · local differs"
								: " merged"}
						</a>
					) : null}
					<span
						{...stylex.attrs(styles.commitMessage)}
						style={domStyle(
							inlineStyles.getCommitRowCommitMessageStyle(
								_props.commit.body ? "64%" : "100%",
							),
						)}
					>
						{_props.commit.message}
					</span>
					{_props.commit.body ? (
						<span {...stylex.attrs(styles.commitBody)}>
							— {_props.commit.body.replace(/\s+/g, " ")}
						</span>
					) : null}
				</>
			)}
		</div>
	);
}
