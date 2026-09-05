import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../../../design-system/styles.stylex.ts";
import {
	IconExternalLink,
	IconGitCommit,
	IconPanelLeft,
} from "../../../../../shared/ui/Icons/index.tsx";
import { FileChangeTotals } from "./FileChangeTotals.tsx";
import { FileViewToggle } from "./FileViewToggle.tsx";
import { styles } from "./styles.ts";

export function ChangesPanelHeader({
	onCollapse,
	onOpenGraph,
	graphActive,
	additions,
	deletions,
	fileViewMode,
	onFileViewModeChange,
	showFileControls,
	worktreePath,
	onOpenWorktree,
}: {
	onCollapse?: () => void;
	onOpenGraph?: () => void;
	graphActive: boolean;
	additions: number;
	deletions: number;
	fileViewMode: "path" | "tree";
	onFileViewModeChange: (mode: "path" | "tree") => void;
	showFileControls: boolean;
	worktreePath?: string;
	onOpenWorktree?: () => void;
}) {
	return (
		<div {...stylex.props(styles.sidebarHeader)}>
			{onCollapse ? (
				<button
					type="button"
					onPointerDown={(event) => {
						if (event.button === 0 && event.isPrimary) onCollapse();
					}}
					onClick={(event) => {
						if (event.detail === 0) onCollapse();
					}}
					title="Collapse files sidebar"
					aria-label="Collapse files sidebar"
					{...stylex.props(styles.headerIconButton)}
				>
					<IconPanelLeft size={iconSize.md} />
				</button>
			) : null}
			{onOpenGraph ? (
				<button
					type="button"
					onClick={onOpenGraph}
					title="Repository graph"
					aria-label="Repository graph"
					{...stylex.props(
						styles.headerIconButton,
						graphActive && styles.headerIconButtonActive,
					)}
				>
					<IconGitCommit size={iconSize.compact} />
				</button>
			) : null}
			{showFileControls ? (
				<FileViewToggle value={fileViewMode} onChange={onFileViewModeChange} />
			) : null}
			<span {...stylex.props(styles.spacer)} />
			{showFileControls ? (
				<FileChangeTotals additions={additions} deletions={deletions} />
			) : null}
			{onOpenWorktree ? (
				<button
					type="button"
					onClick={onOpenWorktree}
					title={`Open linked worktree ${worktreePath ?? ""}`.trim()}
					aria-label="Open linked worktree"
					{...stylex.props(styles.headerIconButton)}
				>
					<IconExternalLink size={iconSize.compact} />
				</button>
			) : null}
		</div>
	);
}
