import * as stylex from "@octanejs/stylex";
import { useCallback, useEffect, useMemo, useRef, useState } from "octane";
import {
	iconSize,
	selectionAppearance,
} from "../../../../../design-system/styles.stylex.ts";
import { IconChevronRight } from "../../../../../shared/ui/Icons/index.tsx";
import type {
	GitFileEntry,
	GitFilePresentation,
} from "../../../../repository/model/types.ts";
import type { SelectedFile } from "../../../model/workbench-model.ts";
import { styles } from "./styles.ts";
import { TreeNodeRow } from "./TreeNodeRow.tsx";

export function FileGroup({
	title,
	files,
	filePresentation,
	selected,
	onSelect,
	actionLabel,
	onAction,
	onActionAll,
	isCollapsible = true,
	showHeader = true,
	viewMode = "path",
	splitPane = false,
}: {
	title: string;
	files: GitFileEntry[];
	filePresentation?: GitFilePresentation;
	selected: SelectedFile | null;
	onSelect: (f: GitFileEntry) => void;
	actionLabel?: string;
	onAction?: (path: string) => void;
	onActionAll?: () => void;
	isCollapsible?: boolean;
	showHeader?: boolean;
	viewMode?: "path" | "tree";
	splitPane?: boolean;
}) {
	const [isCollapsed, setIsCollapsed] = useState(false);
	const [hoveredActionPath, setHoveredActionPath] = useState<string | null>(
		null,
	);
	const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
	const groupRef = useRef<HTMLDivElement | null>(null);

	const toggleDir = useCallback((path: string) => {
		setCollapsedDirs((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	}, []);

	const visibleFiles = useMemo(
		() => new Map(files.map((file) => [file.path, file])),
		[files],
	);
	const visibleCounts = useMemo(() => {
		const order = filePresentation?.treeOrder ?? [];
		const counts = new Uint32Array(order.length + 1);
		for (let index = 0; index < order.length; index++) {
			counts[index + 1] =
				counts[index]! + (visibleFiles.has(order[index]!) ? 1 : 0);
		}
		return counts;
	}, [filePresentation, visibleFiles]);
	useEffect(() => {
		if (!selected) return;
		groupRef.current
			?.querySelector<HTMLElement>('[data-git-file-active="true"]')
			?.scrollIntoView?.({ block: "nearest" });
	}, [selected, viewMode]);
	const isEmpty = files.length === 0;
	const toggleGroup = () => {
		if (isCollapsible && !isEmpty) setIsCollapsed(!isCollapsed);
	};

	const rowProps = {
		visibleFiles,
		visibleCounts,
		selected,
		onSelect,
		onAction,
		actionLabel,
		hoveredActionPath,
		onActionHover: setHoveredActionPath,
		collapsedDirs,
		toggleDir,
	};

	return (
		<div
			ref={groupRef}
			{...stylex.props(styles.fileGroup, splitPane && styles.splitFileGroup)}
		>
			{showHeader ? (
				<div
					{...stylex.props(
						styles.groupHeader,
						title === "Staged" && styles.groupHeaderSeparated,
					)}
				>
					<button
						type="button"
						onPointerDown={(event) => {
							if (event.button === 0 && event.isPrimary) toggleGroup();
						}}
						onClick={(event) => {
							if (event.detail === 0) toggleGroup();
						}}
						{...stylex.props(
							styles.groupToggle,
							isCollapsible && !isEmpty
								? styles.cursorPointer
								: styles.cursorDefault,
						)}
					>
						{isCollapsible && (
							<IconChevronRight
								size={iconSize.sm}
								{...stylex.props(
									styles.chevron,
									!isCollapsed && !isEmpty && styles.chevronOpen,
								)}
							/>
						)}
						<span {...stylex.props(styles.sectionTitle, styles.fileGroupTitle)}>
							{title} Files
						</span>
						<span {...stylex.props(styles.countPill)}>{files.length}</span>
					</button>
					{onActionAll && !isCollapsed && actionLabel && !isEmpty && (
						<button
							type="button"
							onClick={onActionAll}
							title={`${actionLabel} all files`}
							aria-label={`${actionLabel} all files`}
							{...stylex.props(
								styles.segmentButton,
								styles.actionAllButton,
								...selectionAppearance("view", false),
							)}
						>
							{actionLabel} All
						</button>
					)}
				</div>
			) : null}
			{isEmpty ? (
				<div {...stylex.props(styles.emptyGroupBody)}>
					<span {...stylex.props(styles.emptyGroupText)}>
						No {title.toLowerCase()} changes
					</span>
				</div>
			) : !isCollapsed ? (
				<div
					{...stylex.props(
						styles.groupList,
						splitPane && styles.splitGroupList,
					)}
				>
					{(viewMode === "path" || !filePresentation) &&
						files.map((file) => (
							<TreeNodeRow
								{...rowProps}
								key={`${file.staged ? "s" : "u"}-${file.path}`}
								pathFile={file}
							/>
						))}
					{viewMode === "tree" && filePresentation && (
						<div>
							{filePresentation.tree.map((child) => (
								<TreeNodeRow {...rowProps} key={child.path} node={child} />
							))}
						</div>
					)}
				</div>
			) : null}
		</div>
	);
}
