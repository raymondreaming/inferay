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

export function TreeNodeRow(props: {
	node?: GitFileTreeNode;
	pathFile?: GitFileEntry;
	visibleFiles: Map<string, GitFileEntry>;
	visibleCounts: Uint32Array;
	depth?: number;
	selected: SelectedFile | null;
	onSelect: (f: GitFileEntry) => void;
	onAction?: (path: string) => void;
	actionLabel?: string;
	hoveredActionPath: string | null;
	onActionHover: (path: string | null) => void;
	collapsedDirs: Set<string>;
	toggleDir: (path: string) => void;
}) {
	const {
		node,
		pathFile,
		visibleFiles,
		visibleCounts,
		depth = 0,
		selected,
		onSelect,
		onAction,
		actionLabel,
		hoveredActionPath,
		onActionHover,
		collapsedDirs,
		toggleDir,
	} = props;
	const isDir = !!node?.children.length;
	const isExpanded = !collapsedDirs.has(node?.path ?? "");
	const file =
		pathFile ?? (isDir || !node ? undefined : visibleFiles.get(node.path));
	const separator = file?.path.lastIndexOf("/") ?? -1;
	if (
		node &&
		visibleCounts[node.fileRange[1]] === visibleCounts[node.fileRange[0]]
	)
		return null;
	const active =
		file && selected?.path === file.path && selected?.staged === file.staged;

	const selectTreeNode = () => {
		if (isDir && node) {
			toggleDir(node.path);
		} else if (file) {
			onSelect(file);
		}
	};

	return (
		<>
			<div
				data-git-file-active={active ? "true" : undefined}
				{...stylex.props(
					node ? styles.treeRow : styles.pathRow,
					active && styles.fileRowActive,
				)}
				style={
					node
						? inlineStyles.getTreeNodeRowTreeRowStyle(`${4 + depth * 9}px`)
						: undefined
				}
				onMouseEnter={() => {
					if (!file) return;
					onActionHover(file.path);
				}}
				onMouseLeave={() => file && onActionHover(null)}
			>
				<button
					type="button"
					title={node ? undefined : file?.path}
					data-git-file-select
					{...stylex.props(node ? styles.treeNodeButton : styles.fileRowButton)}
					onPointerDown={(event) => {
						if (event.button === 0 && event.isPrimary) selectTreeNode();
					}}
					onClick={(event) => {
						if (event.detail === 0) selectTreeNode();
					}}
				>
					{isDir && node ? (
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
							{node && <span {...stylex.props(styles.treeIndentSpacer)} />}
							<FileChangeIcon file={file} />
							{node ? (
								<span
									{...stylex.props(
										styles.treeFileName,
										active && styles.activeText,
									)}
								>
									{node.name}
								</span>
							) : (
								<span {...stylex.props(styles.fileButton)}>
									{separator >= 0 && (
										<span {...stylex.props(styles.pathDirectory)}>
											{file.path.slice(0, separator)}
										</span>
									)}
									<span {...stylex.props(styles.pathFileName)}>
										{separator >= 0 ? file.path.slice(separator) : file.path}
									</span>
								</span>
							)}
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
							node ? styles.rowAction : styles.rowActionSubtle,
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
				node?.children.map((child) => (
					<TreeNodeRow
						{...props}
						key={child.path}
						node={child}
						depth={depth + 1}
					/>
				))}
		</>
	);
}
