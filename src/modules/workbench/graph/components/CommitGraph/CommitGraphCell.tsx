import * as stylex from "@octanejs/stylex";
import type { GraphNode } from "../../../../repository/hooks/useGitGraph.tsx";
import { AuthorAvatar } from "./AuthorAvatar.tsx";
import { MergeNode } from "./MergeNode.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

export function CommitGraphCell({
	commit,
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
	commit: GraphNode;
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
						commit.color,
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
						commit.color,
					)}
				/>
			) : isMergeCommit ? (
				<MergeNode color={commit.color} left={nodeLeft} top={nodeTop} />
			) : (
				<AuthorAvatar
					name={commit.author}
					email={commit.authorEmail}
					githubAvatar={githubAvatar}
					color={commit.color}
					left={nodeLeft}
					top={nodeTop}
					stash={isStash}
				/>
			)}
		</div>
	);
}
