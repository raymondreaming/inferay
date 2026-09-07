import * as stylex from "@stylexjs/stylex";
import { iconSize } from "../../../../../design-system/styles.stylex.ts";
import {
	IconGitCommit,
	IconPanelLeft,
} from "../../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";
export const CollapsedChangesPanel = function CollapsedChangesPanel(_props: {
	stagedCount: number;
	unstagedCount: number;
	onExpand: () => void;
	onOpenGraph?: () => void;
	graphActive?: boolean;
}) {
	return (
		<div {...stylex.attrs(styles.collapsedRoot)}>
			<button
				type="button"
				onPointerDown={(event) => {
					if (event.button === 0 && event.isPrimary) _props.onExpand();
				}}
				onClick={(event) => {
					if (event.detail === 0) _props.onExpand();
				}}
				title="Expand files sidebar"
				aria-label="Expand files sidebar"
				{...stylex.attrs(styles.collapsedToggle)}
			>
				<IconPanelLeft size={iconSize._2md} />
			</button>
			{_props.onOpenGraph ? (
				<button
					type="button"
					onClick={_props.onOpenGraph}
					title="Repository graph"
					aria-label="Repository graph"
					{...stylex.attrs(
						styles.collapsedGraphButton,
						(_props.graphActive === undefined ? false : _props.graphActive) &&
							styles.headerIconButtonActive,
					)}
				>
					<IconGitCommit size={iconSize.md} />
				</button>
			) : null}
			<div {...stylex.attrs(styles.collapsedCounts)}>
				<div
					{...stylex.attrs(styles.collapsedCount)}
					title={`${_props.unstagedCount} unstaged ${_props.unstagedCount === 1 ? "file" : "files"}`}
				>
					<span {...stylex.attrs(styles.unstagedDot)} />
					<span>{_props.unstagedCount}</span>
				</div>
				<div
					{...stylex.attrs(styles.collapsedCount)}
					title={`${_props.stagedCount} staged ${_props.stagedCount === 1 ? "file" : "files"}`}
				>
					<span {...stylex.attrs(styles.stagedDot)} />
					<span>{_props.stagedCount}</span>
				</div>
			</div>
		</div>
	);
};
