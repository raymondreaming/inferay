import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../../../design-system/styles.stylex.ts";
import {
	IconChevronRight,
	IconFolderFill,
} from "../../../../../shared/ui/Icons/index.tsx";
import type {
	GitFileEntry,
	GitFileTreeNode,
} from "../../../../repository/model/types.ts";
import type { SelectedFile } from "../../../model/workbench-model.ts";
import { FileActionIcon } from "./FileActionIcon.tsx";
import { FileChangeIcon } from "./FileChangeIcon.tsx";
import { FileDiffStats } from "./FileDiffStats.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

export function TreeNodeRow({
	node,
	visibleFiles,
	visibleCounts,
	depth,
	selected,
	onSelect,
	onAction,
	actionLabel,
	hoveredActionPath,
	onActionHover,
	collapsedDirs,
	toggleDir,
}: {
	node: GitFileTreeNode;
	visibleFiles: Map<string, GitFileEntry>;
	visibleCounts: Uint32Array;
	depth: number;
	selected: SelectedFile | null;
	onSelect: (f: GitFileEntry) => void;
	onAction?: (path: string) => void;
	actionLabel?: string;
	hoveredActionPath: string | null;
	onActionHover: (path: string | null) => void;
	collapsedDirs: Set<string>;
	toggleDir: (path: string) => void;
}) {
	const isDir = node.children.length > 0;
	const isExpanded = !collapsedDirs.has(node.path);
	const file = isDir ? undefined : visibleFiles.get(node.path);
	if (visibleCounts[node.fileRange[1]] === visibleCounts[node.fileRange[0]])
		return null;
	const active =
		file && selected?.path === file.path && selected?.staged === file.staged;

	const sortedChildren = node.children;
	const selectTreeNode = () => {
		if (isDir) {
			toggleDir(node.path);
		} else if (file) {
			onSelect(file);
		}
	};

	return (
		<>
			<div
				data-git-file-active={active ? "true" : undefined}
				{...stylex.props(styles.treeRow, active && styles.fileRowActive)}
				style={inlineStyles.getTreeNodeRowTreeRowStyle(`${4 + depth * 9}px`)}
				onMouseEnter={() => {
					if (!file) return;
					onActionHover(file.path);
				}}
				onMouseLeave={() => file && onActionHover(null)}
			>
				<button
					type="button"
					data-git-file-select
					{...stylex.props(styles.treeNodeButton)}
					onPointerDown={(event) => {
						if (event.button === 0 && event.isPrimary) selectTreeNode();
					}}
					onClick={(event) => {
						if (event.detail === 0) selectTreeNode();
					}}
				>
					{isDir ? (
						<>
							<IconChevronRight
								size={iconSize.sm}
								{...stylex.props(
									styles.chevron,
									isExpanded && styles.chevronOpen,
								)}
							/>
							<IconFolderFill
								size={iconSize.md}
								{...stylex.props(
									styles.folderIcon,
									isExpanded && styles.folderIconOpen,
								)}
							/>
							<span {...stylex.props(styles.treeName)}>{node.name}</span>
						</>
					) : file ? (
						<>
							<span {...stylex.props(styles.treeIndentSpacer)} />
							<FileChangeIcon file={file} />
							<span
								{...stylex.props(
									styles.treeFileName,
									active && styles.activeText,
								)}
							>
								{node.name}
							</span>
							{hoveredActionPath !== file.path ? (
								<FileDiffStats file={file} />
							) : null}
						</>
					) : null}
				</button>
				{file && onAction && (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onAction(file.path);
						}}
						{...stylex.props(
							styles.rowAction,
							hoveredActionPath === file.path && styles.rowActionVisible,
						)}
						aria-label={`${actionLabel} ${file.path}`}
					>
						<FileActionIcon actionLabel={actionLabel} />
					</button>
				)}
			</div>
			{isDir &&
				isExpanded &&
				sortedChildren.map((child) => (
					<TreeNodeRow
						key={child.path}
						node={child}
						visibleFiles={visibleFiles}
						visibleCounts={visibleCounts}
						depth={depth + 1}
						selected={selected}
						onSelect={onSelect}
						onAction={onAction}
						actionLabel={actionLabel}
						hoveredActionPath={hoveredActionPath}
						onActionHover={onActionHover}
						collapsedDirs={collapsedDirs}
						toggleDir={toggleDir}
					/>
				))}
		</>
	);
}
