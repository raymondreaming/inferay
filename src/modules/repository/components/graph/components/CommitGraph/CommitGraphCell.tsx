import type { GraphCommit } from "@contracts";
import { domStyle } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import { AuthorAvatar } from "./AuthorAvatar.tsx";
import { MergeNode } from "./MergeNode.tsx";
import * as inlineStyles from "./styles.ts";
import { GRAPH_DASH_PATTERN, GRAPH_DASH_WIDTH, styles } from "./styles.ts";
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
					style={domStyle({
						...inlineStyles.getCommitRowRefToNodeConnectorStyle(
							_props.nodeCenter,
							_props.color,
						),
						...(_props.isWip || _props.isStash
							? {
									backgroundColor: "transparent",
									backgroundImage: `repeating-linear-gradient(to right, ${_props.color} 0 2px, transparent 2px 3px)`,
								}
							: {}),
					})}
				/>
			) : null}
			{_props.isWip ? (
				<svg
					aria-hidden="true"
					viewBox="0 0 18 18"
					width="18"
					height="18"
					{...stylex.attrs(styles.wipNode)}
					style={domStyle({ left: _props.nodeLeft, top: _props.nodeTop })}
				>
					<circle
						cx="9"
						cy="9"
						r="8.5"
						fill="var(--color-inferay-black)"
						stroke={_props.color}
						stroke-dasharray={GRAPH_DASH_PATTERN}
						stroke-width={GRAPH_DASH_WIDTH}
						stroke-linecap="round"
						pathLength={54}
						stroke-dashoffset={0.5}
					/>
				</svg>
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
