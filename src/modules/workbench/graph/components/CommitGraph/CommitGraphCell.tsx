import * as stylex from "@octanejs/stylex";
import type { GraphCommit } from "../../../../../../build/presentation/contracts/GraphCommit.ts";

import { AuthorAvatar } from "./AuthorAvatar.tsx";
import { MergeNode } from "./MergeNode.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

export function CommitGraphCell({
	commit,
	color,
	graphWidth,
	hasConnector,
	nodeCenter,
	nodeLeft,
	nodeTop,
	isWip,
	isMergeCommit,
	isStash,
	githubAvatar,
}: {
	commit: GraphCommit;
	color: string;
	graphWidth: number;
	hasConnector: boolean;
	nodeCenter: number;
	nodeLeft: number;
	nodeTop: number;
	isWip: boolean;
	isMergeCommit: boolean;
	isStash: boolean;
	githubAvatar: string | null | undefined;
}) {
	return (
		<div
			{...stylex.props(styles.graphCell)}
			style={inlineStyles.getCommitRowGraphCellStyle(graphWidth)}
		>
			{hasConnector ? (
				<span
					aria-hidden="true"
					{...stylex.props(styles.refToNodeConnector)}
					style={inlineStyles.getCommitRowRefToNodeConnectorStyle(
						nodeCenter,
						color,
					)}
				/>
			) : null}
			{isWip ? (
				<span
					aria-hidden="true"
					{...stylex.props(styles.wipNode)}
					style={inlineStyles.getCommitRowWipNodeStyle(
						nodeLeft,
						nodeTop,
						color,
					)}
				/>
			) : isMergeCommit ? (
				<MergeNode color={color} left={nodeLeft} top={nodeTop} />
			) : (
				<AuthorAvatar
					name={commit.author}
					email={commit.authorEmail}
					githubAvatar={githubAvatar}
					color={color}
					left={nodeLeft}
					top={nodeTop}
					stash={isStash}
				/>
			)}
		</div>
	);
}
