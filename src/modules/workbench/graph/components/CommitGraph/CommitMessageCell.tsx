import * as stylex from "@octanejs/stylex";
import type { GraphCommit } from "../../../../../../build/presentation/contracts/GraphCommit.ts";

import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

export function CommitMessageCell({
	commit,
	color,
	width,
	isWip,
	showWipRef,
	worktreeLabel,
	fileCount,
}: {
	commit: GraphCommit;
	color: string;
	width: number;
	isWip: boolean;
	showWipRef: boolean;
	worktreeLabel: string;
	fileCount: number;
}) {
	return (
		<div
			{...stylex.props(styles.messageCell)}
			style={inlineStyles.getCommitRowMessageCellStyle(
				width,
				`1px solid ${color}`,
			)}
		>
			<span
				{...stylex.props(styles.commitMessage)}
				style={inlineStyles.getCommitRowCommitMessageStyle(
					commit.body ? "64%" : "100%",
				)}
			>
				{isWip
					? showWipRef
						? `// WIP ${worktreeLabel}`
						: "// WIP"
					: commit.message}
			</span>
			{!isWip && commit.body ? (
				<span {...stylex.props(styles.commitBody)}>
					— {commit.body.replace(/\s+/g, " ")}
				</span>
			) : null}
			{isWip ? (
				<span {...stylex.props(styles.fileCount)}>
					{fileCount} file{fileCount === 1 ? "" : "s"}
				</span>
			) : null}
		</div>
	);
}
