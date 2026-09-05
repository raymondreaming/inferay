import * as stylex from "@octanejs/stylex";
import { memo } from "octane";
import { iconSize } from "../../../../../design-system/styles.stylex.ts";
import {
	IconGitCommit,
	IconPanelLeft,
} from "../../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";

export const CollapsedChangesPanel = memo(function CollapsedChangesPanel({
	stagedCount,
	unstagedCount,
	onExpand,
	onOpenGraph,
	graphActive = false,
}: {
	stagedCount: number;
	unstagedCount: number;
	onExpand: () => void;
	onOpenGraph?: () => void;
	graphActive?: boolean;
}) {
	return (
		<div {...stylex.props(styles.collapsedRoot)}>
			<button
				type="button"
				onPointerDown={(event) => {
					if (event.button === 0 && event.isPrimary) onExpand();
				}}
				onClick={(event) => {
					if (event.detail === 0) onExpand();
				}}
				title="Expand files sidebar"
				aria-label="Expand files sidebar"
				{...stylex.props(styles.collapsedToggle)}
			>
				<IconPanelLeft size={iconSize._2md} />
			</button>
			{onOpenGraph ? (
				<button
					type="button"
					onClick={onOpenGraph}
					title="Repository graph"
					aria-label="Repository graph"
					{...stylex.props(
						styles.collapsedGraphButton,
						graphActive && styles.headerIconButtonActive,
					)}
				>
					<IconGitCommit size={iconSize.md} />
				</button>
			) : null}
			<div {...stylex.props(styles.collapsedCounts)}>
				<div
					{...stylex.props(styles.collapsedCount)}
					title={`${unstagedCount} unstaged ${unstagedCount === 1 ? "file" : "files"}`}
				>
					<span {...stylex.props(styles.unstagedDot)} />
					<span>{unstagedCount}</span>
				</div>
				<div
					{...stylex.props(styles.collapsedCount)}
					title={`${stagedCount} staged ${stagedCount === 1 ? "file" : "files"}`}
				>
					<span {...stylex.props(styles.stagedDot)} />
					<span>{stagedCount}</span>
				</div>
			</div>
		</div>
	);
});
