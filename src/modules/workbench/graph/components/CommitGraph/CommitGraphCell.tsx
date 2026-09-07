import * as stylex from "@stylexjs/stylex";
import type { GraphCommit } from "../../../../../../build/presentation/contracts/GraphCommit.ts";
import { domStyle } from "../../../../../shared/lib/dom.tsx";
import { AuthorAvatar } from "./AuthorAvatar.tsx";
import { MergeNode } from "./MergeNode.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
export function CommitGraphCell(_props: {
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
			{...stylex.attrs(styles.graphCell)}
			style={domStyle(
				inlineStyles.getCommitRowGraphCellStyle(_props.graphWidth),
			)}
		>
			{_props.hasConnector ? (
				<span
					aria-hidden="true"
					{...stylex.attrs(styles.refToNodeConnector)}
					style={domStyle(
						inlineStyles.getCommitRowRefToNodeConnectorStyle(
							_props.nodeCenter,
							_props.color,
						),
					)}
				/>
			) : null}
			{_props.isWip ? (
				<span
					aria-hidden="true"
					{...stylex.attrs(styles.wipNode)}
					style={domStyle(
						inlineStyles.getCommitRowWipNodeStyle(
							_props.nodeLeft,
							_props.nodeTop,
							_props.color,
						),
					)}
				/>
			) : _props.isMergeCommit ? (
				<MergeNode
					color={_props.color}
					left={_props.nodeLeft}
					top={_props.nodeTop}
				/>
			) : (
				<AuthorAvatar
					name={_props.commit.author}
					email={_props.commit.authorEmail}
					githubAvatar={_props.githubAvatar}
					color={_props.color}
					left={_props.nodeLeft}
					top={_props.nodeTop}
					stash={_props.isStash}
				/>
			)}
		</div>
	);
}
