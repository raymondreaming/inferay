import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, For } from "solid-js";
import type { GitFileEntry } from "../../../../../../build/presentation/contracts/GitFileEntry.ts";
import type { GitFilePresentation } from "../../../../../../build/presentation/contracts/GitFilePresentation.ts";
import {
	iconSize,
	selectionAppearance,
} from "../../../../../design-system/styles.stylex.ts";
import { ariaValue } from "../../../../../shared/lib/dom.tsx";
import { IconChevronRight } from "../../../../../shared/ui/Icons/index.tsx";
import type { SelectedFile } from "./index.tsx";
import { styles } from "./styles.ts";
import { TreeNodeRow } from "./TreeNodeRow.tsx";
export function FileGroup(_props: {
	title: string;
	files: GitFileEntry[];
	filePresentation?: GitFilePresentation;
	selected: SelectedFile | null;
	onPrefetchFile?: (file: GitFileEntry | null) => void;
	onSelect: (f: GitFileEntry) => void;
	actionLabel?: string;
	onAction?: (path: string) => void;
	onActionAll?: () => void;
	isCollapsible?: boolean;
	showHeader?: boolean;
	viewMode?: "path" | "tree";
	splitPane?: boolean;
}) {
	const [isCollapsed, setIsCollapsed] = createSignal(false);
	const [collapsedDirs, setCollapsedDirs] = createSignal<Set<string>>(
		new Set(),
	);
	const groupRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const toggleDir = (path: string) => {
		setCollapsedDirs((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	};
	const visibleFiles = createMemo(
		() => new Map(_props.files.map((file) => [file.path, file])),
	);
	const visibleCounts = createMemo(() => {
		const order = _props.filePresentation?.treeOrder ?? [];
		const counts = new Uint32Array(order.length + 1);
		for (let index = 0; index < order.length; index++) {
			counts[index + 1] =
				counts[index]! + (visibleFiles().has(order[index]!) ? 1 : 0);
		}
		return counts;
	});
	const selectionKey = createMemo(() =>
		JSON.stringify([
			_props.selected?.path,
			_props.selected?.staged,
			_props.viewMode ?? "path",
		]),
	);
	createEffect(selectionKey, () => {
		if (!_props.selected) return;
		groupRef.current
			?.querySelector<HTMLElement>('[data-git-file-active="true"]')
			?.scrollIntoView?.({
				block: "nearest",
			});
	});
	const isEmpty = createMemo(() => _props.files.length === 0);
	const toggleGroup = () => {
		if (
			(_props.isCollapsible === undefined ? true : _props.isCollapsible) &&
			!isEmpty()
		)
			setIsCollapsed(!isCollapsed());
	};
	// Independent getters prevent hover/selection changes from invalidating
	// every tree row through one shared snapshot.
	const rowProps = {
		get visibleFiles() {
			return visibleFiles();
		},
		get visibleCounts() {
			return visibleCounts();
		},
		get selected() {
			return _props.selected;
		},
		get onPrefetchFile() {
			return _props.onPrefetchFile;
		},
		get onSelect() {
			return _props.onSelect;
		},
		get onAction() {
			return _props.onAction;
		},
		get actionLabel() {
			return _props.actionLabel;
		},
		get collapsedDirs() {
			return collapsedDirs();
		},
		toggleDir,
	};
	return (
		<div
			ref={(element) => (groupRef.current = element)}
			{...stylex.attrs(
				styles.fileGroup,
				(_props.splitPane === undefined ? false : _props.splitPane) &&
					styles.splitFileGroup,
			)}
		>
			{(_props.showHeader === undefined ? true : _props.showHeader) ? (
				<div
					{...stylex.attrs(
						styles.groupHeader,
						_props.title === "Staged" && styles.groupHeaderSeparated,
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
						{...stylex.attrs(
							styles.groupToggle,
							(_props.isCollapsible === undefined
								? true
								: _props.isCollapsible) && !isEmpty()
								? styles.cursorPointer
								: styles.cursorDefault,
						)}
					>
						{(_props.isCollapsible === undefined
							? true
							: _props.isCollapsible) && (
							<IconChevronRight
								size={iconSize.sm}
								{...stylex.attrs(
									styles.chevron,
									!isCollapsed() && !isEmpty() && styles.chevronOpen,
								)}
							/>
						)}
						<span {...stylex.attrs(styles.sectionTitle, styles.fileGroupTitle)}>
							{_props.title} Files
						</span>
						<span {...stylex.attrs(styles.countPill)}>
							{_props.files.length}
						</span>
					</button>
					{_props.onActionAll &&
						!isCollapsed() &&
						_props.actionLabel &&
						!isEmpty() && (
							<button
								type="button"
								onClick={_props.onActionAll}
								title={`${_props.actionLabel} all files`}
								aria-label={ariaValue(`${_props.actionLabel} all files`)}
								{...stylex.attrs(
									styles.segmentButton,
									styles.actionAllButton,
									...selectionAppearance("view", false),
								)}
							>
								{_props.actionLabel} All
							</button>
						)}
				</div>
			) : null}
			{isEmpty() ? (
				<div {...stylex.attrs(styles.emptyGroupBody)}>
					<span {...stylex.attrs(styles.emptyGroupText)}>
						No {_props.title.toLowerCase()} changes
					</span>
				</div>
			) : !isCollapsed() ? (
				<div
					{...stylex.attrs(
						styles.groupList,
						(_props.splitPane === undefined ? false : _props.splitPane) &&
							styles.splitGroupList,
					)}
				>
					{((_props.viewMode === undefined ? "path" : _props.viewMode) ===
						"path" ||
						!_props.filePresentation) && (
						<For each={_props.files} keyed={(row) => row.path}>
							{(file) => <TreeNodeRow {...rowProps} pathFile={file()} />}
						</For>
					)}
					{(_props.viewMode === undefined ? "path" : _props.viewMode) ===
						"tree" &&
						!!_props.filePresentation && (
							<div>
								{
									<For
										each={_props.filePresentation!.tree}
										keyed={(row) => row.path}
									>
										{(child) => <TreeNodeRow {...rowProps} node={child()} />}
									</For>
								}
							</div>
						)}
				</div>
			) : null}
		</div>
	);
}
