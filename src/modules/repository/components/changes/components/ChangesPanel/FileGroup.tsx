import type { GitFilePresentation, SelectedPanelFile } from "@contracts";
import { iconSize, selectionAppearance } from "@design-system/styles.stylex.ts";
import { ContextMenu } from "@repository/components/graph/components/CommitGraph/ContextMenu.tsx";
import { ariaValue } from "@shared/lib/dom.tsx";
import { IconChevronRight, IconTrash } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, For, merge } from "solid-js";
import { styles } from "./styles.ts";
import { type FileRowEntry, TreeNodeRow } from "./TreeNodeRow.tsx";

type SelectedFile = Pick<SelectedPanelFile, "path" | "staged">;
export function FileGroup<T extends FileRowEntry>(_props: {
	title: string;
	files: T[];
	filePresentation?: GitFilePresentation;
	selected: SelectedFile | null;
	onPrefetchFile?: (file: T | null) => void;
	onSelect: (f: T) => void;
	actionLabel?: string;
	onAction?: (path: string) => void;
	onActionAll?: () => void;
	onStash?: (path: string) => void;
	onDiscard?: (path: string) => void;
	onDiscardAll?: () => void;
	isCollapsible?: boolean;
	showHeader?: boolean;
	viewMode?: "path" | "tree";
	splitPane?: boolean;
}) {
	const [isCollapsed, setIsCollapsed] = createSignal(false);
	const [menu, setMenu] = createSignal<{
		file: T;
		x: number;
		y: number;
	} | null>(null);
	const [collapsedDirs, setCollapsedDirs] = createSignal<Set<string>>(
		new Set(),
	);
	let groupElement: HTMLDivElement | undefined;
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
		groupElement
			?.querySelector<HTMLElement>('[data-git-file-active="true"]')
			?.scrollIntoView?.({
				block: "nearest",
			});
	});
	const isEmpty = createMemo(() => _props.files.length === 0);
	const toggleGroup = () => {
		if (_props.isCollapsible !== false && !isEmpty())
			setIsCollapsed(!isCollapsed());
	};
	// Independent getters prevent hover/selection changes from invalidating
	// every tree row through one shared snapshot.
	const rowProps = merge(_props, {
		get visibleFiles() {
			return visibleFiles();
		},
		get visibleCounts() {
			return visibleCounts();
		},
		get onContextMenu() {
			return _props.onAction || _props.onStash || _props.onDiscard
				? (file: T, event: MouseEvent) =>
						setMenu({
							file,
							x: Math.min(event.clientX, window.innerWidth - 224),
							y: Math.min(event.clientY, window.innerHeight - 160),
						})
				: undefined;
		},
		get collapsedDirs() {
			return collapsedDirs();
		},
		toggleDir,
	});
	return (
		<div
			ref={(element) => (groupElement = element)}
			{...stylex.attrs(
				styles.fileGroup,
				_props.splitPane && styles.splitFileGroup,
			)}
		>
			{_props.showHeader !== false ? (
				<div {...stylex.attrs(styles.groupHeader)}>
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
							_props.isCollapsible !== false && !isEmpty()
								? styles.cursorPointer
								: styles.cursorDefault,
						)}
					>
						{_props.isCollapsible !== false && (
							<IconChevronRight
								size={iconSize.sm}
								{...stylex.attrs(
									styles.chevron,
									!isCollapsed() && !isEmpty() && styles.chevronOpen,
								)}
							/>
						)}
						<span {...stylex.attrs(styles.sectionTitle, styles.fileGroupTitle)}>
							{_props.title}
						</span>
						<span {...stylex.attrs(styles.countPill)}>
							{_props.files.length}
						</span>
					</button>
					{_props.onDiscardAll && !isEmpty() && (
						<button
							type="button"
							onClick={_props.onDiscardAll}
							title={`Discard all ${_props.title.toLowerCase()} changes`}
							aria-label={`Discard all ${_props.title.toLowerCase()} changes`}
							{...stylex.attrs(styles.headerIconButton)}
						>
							<IconTrash size={iconSize.sm} />
						</button>
					)}
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
						_props.splitPane && styles.splitGroupList,
					)}
				>
					{((_props.viewMode ?? "path") === "path" ||
						!_props.filePresentation) && (
						<For each={_props.files} keyed={(row) => row.path}>
							{(file) => <TreeNodeRow {...rowProps} pathFile={file()} />}
						</For>
					)}
					{(_props.viewMode ?? "path") === "tree" &&
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
			{menu() && (
				<ContextMenu
					x={menu()!.x}
					y={menu()!.y}
					title={menu()!.file.path}
					entries={(
						[
							[
								_props.actionLabel && `${_props.actionLabel} file`,
								_props.onAction,
							],
							["Stash file", _props.onStash],
							["Discard changes…", _props.onDiscard],
						] as const
					).flatMap(([label, run]) =>
						label && run ? [{ label, run: () => run(menu()!.file.path) }] : [],
					)}
					onClose={() => setMenu(null)}
				/>
			)}
		</div>
	);
}
