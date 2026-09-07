import * as stylex from "@stylexjs/stylex";
import type { GraphCommit } from "../../../../../../build/presentation/contracts/GraphCommit.ts";
import { domStyle } from "../../../../../shared/lib/dom.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
export function CommitMessageCell(_props: {
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
			{...stylex.attrs(styles.messageCell)}
			style={domStyle(
				inlineStyles.getCommitRowMessageCellStyle(
					_props.width,
					`1px solid ${_props.color}`,
				),
			)}
		>
			<span
				{...stylex.attrs(styles.commitMessage)}
				style={domStyle(
					inlineStyles.getCommitRowCommitMessageStyle(
						_props.commit.body ? "64%" : "100%",
					),
				)}
			>
				{_props.isWip
					? _props.showWipRef
						? `// WIP ${_props.worktreeLabel}`
						: "// WIP"
					: _props.commit.message}
			</span>
			{!_props.isWip && _props.commit.body ? (
				<span {...stylex.attrs(styles.commitBody)}>
					— {_props.commit.body.replace(/\s+/g, " ")}
				</span>
			) : null}
			{_props.isWip ? (
				<span {...stylex.attrs(styles.fileCount)}>
					{_props.fileCount} file{_props.fileCount === 1 ? "" : "s"}
				</span>
			) : null}
		</div>
	);
}
