import type { GraphCommit } from "@contracts";
import { FileChangeTotals } from "@repository/components/changes/components/ChangesPanel/FileChangeTotals.tsx";
import { domStyle } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
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
			{...stylex.attrs(styles.graphCell, _props.isWip && styles.wipGraphCell)}
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
				<>
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
							stroke-dasharray="2 1"
						/>
					</svg>
					<div
						data-graph-wip-summary
						{...stylex.attrs(styles.wipSummary)}
						style={domStyle({ left: _props.nodeCenter + 15 })}
					>
						<span>WIP</span>
						{_props.commit.changeSummary && (
							<>
								<span>
									{_props.commit.changeSummary.files} file
									{_props.commit.changeSummary.files === 1 ? "" : "s"}
								</span>
								<FileChangeTotals
									additions={_props.commit.changeSummary.additions}
									deletions={_props.commit.changeSummary.deletions}
								/>
							</>
						)}
					</div>
				</>
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
