import * as stylex from "@stylexjs/stylex";
import { iconSize } from "../../../../../design-system/styles.stylex.ts";
import {
	IconExternalLink,
	IconGitCommit,
	IconPanelLeft,
} from "../../../../../shared/ui/Icons/index.tsx";
import { FileChangeTotals } from "./FileChangeTotals.tsx";
import { FileViewToggle } from "./FileViewToggle.tsx";
import { styles } from "./styles.ts";
export function ChangesPanelHeader(_props: {
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
		<div {...stylex.attrs(styles.sidebarHeader)}>
			{_props.onCollapse ? (
				<button
					type="button"
					onPointerDown={(event) => {
						if (event.button === 0 && event.isPrimary) _props.onCollapse?.();
					}}
					onClick={(event) => {
						if (event.detail === 0) _props.onCollapse?.();
					}}
					title="Collapse files sidebar"
					aria-label="Collapse files sidebar"
					{...stylex.attrs(styles.headerIconButton)}
				>
					<IconPanelLeft size={iconSize.md} />
				</button>
			) : null}
			{_props.onOpenGraph ? (
				<button
					type="button"
					onClick={_props.onOpenGraph}
					title="Repository graph"
					aria-label="Repository graph"
					{...stylex.attrs(
						styles.headerIconButton,
						_props.graphActive && styles.headerIconButtonActive,
					)}
				>
					<IconGitCommit size={iconSize.compact} />
				</button>
			) : null}
			{_props.showFileControls ? (
				<FileViewToggle
					value={_props.fileViewMode}
					onChange={_props.onFileViewModeChange}
				/>
			) : null}
			<span {...stylex.attrs(styles.spacer)} />
			{_props.showFileControls ? (
				<FileChangeTotals
					additions={_props.additions}
					deletions={_props.deletions}
				/>
			) : null}
			{_props.onOpenWorktree ? (
				<button
					type="button"
					onClick={_props.onOpenWorktree}
					title={`Open linked worktree ${_props.worktreePath ?? ""}`.trim()}
					aria-label="Open linked worktree"
					{...stylex.attrs(styles.headerIconButton)}
				>
					<IconExternalLink size={iconSize.compact} />
				</button>
			) : null}
		</div>
	);
}
