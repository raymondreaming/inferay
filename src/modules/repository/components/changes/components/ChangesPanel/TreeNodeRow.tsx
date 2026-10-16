import type {
	GitFileEntry,
	GitFileTreeNode,
	SelectedPanelFile,
} from "@contracts";
import { iconSize } from "@design-system/styles.stylex.ts";
import { ariaValue } from "@shared/lib/dom.tsx";
import {
	IconChevronRight,
	IconFolderFill,
	IconMinus,
	IconPlus,
} from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, Show } from "solid-js";
import { styles } from "./styles.ts";

type SelectedFile = Pick<SelectedPanelFile, "path" | "staged">;
export type FileRowEntry = Omit<GitFileEntry, "staged"> & { staged?: boolean };
export function TreeNodeRow<T extends FileRowEntry>(props: {
	node?: GitFileTreeNode;
	pathFile?: T;
	visibleFiles: Map<string, T>;
	visibleCounts: Uint32Array;
	depth?: number;
	selected: SelectedFile | null;
	onPrefetchFile?: (file: T | null) => void;
	onSelect: (f: T) => void;
	onAction?: (path: string) => void;
	onContextMenu?: (file: T, event: MouseEvent) => void;
	actionLabel?: string;
	collapsedDirs: Set<string>;
	toggleDir: (path: string) => void;
}) {
	const isDir = createMemo(() => !!props.node?.children.length);
	const isExpanded = createMemo(() => {
		const _sourceValue = props;
		return !_sourceValue.collapsedDirs.has(_sourceValue.node?.path ?? "");
	});
	const file = createMemo(
		() =>
			props.pathFile ??
			(isDir() || !props.node
				? undefined
				: props.visibleFiles.get(props.node.path)),
	);
	const separator = createMemo(() => file()?.path.lastIndexOf("/") ?? -1);
	const [hovered, setHovered] = createSignal(false);
	const visible = createMemo(
		() =>
			!props.node ||
			props.visibleCounts[props.node.fileRange[1]] !==
				props.visibleCounts[props.node.fileRange[0]],
	);
	const active = createMemo(() => {
		const _fileValue = file(),
			_sourceValue3 = props;
		return (
			_fileValue &&
			_sourceValue3.selected?.path === _fileValue.path &&
			_sourceValue3.selected?.staged === (_fileValue.staged ?? false)
		);
	});
	const selectTreeNode = () => {
		const _sourceValue4 = props,
			_fileValue2 = file();
		if (isDir() && _sourceValue4.node) {
			_sourceValue4.toggleDir(_sourceValue4.node.path);
		} else if (_fileValue2) {
			_sourceValue4.onSelect(_fileValue2);
		}
	};
	return (
		<Show when={visible()}>
			<div
				data-git-file-active={active() ? "true" : undefined}
				{...stylex.attrs(
					props.node ? styles.treeRow : styles.pathRow,
					active() && styles.fileRowActive,
				)}
				style={
					props.node
						? {
								"padding-left": `${4 + (props.depth === undefined ? 0 : props.depth) * 9}px`,
								"padding-right": "6px",
							}
						: undefined
				}
				onMouseEnter={() => {
					const _fileValue3 = file();
					if (!_fileValue3) return;
					setHovered(true);
					props.onPrefetchFile?.(_fileValue3);
				}}
				onMouseLeave={() => {
					setHovered(false);
					props.onPrefetchFile?.(null);
				}}
				onContextMenu={(event) => {
					const _fileValue5 = file();
					if (!_fileValue5 || !props.onContextMenu) return;
					event.preventDefault();
					props.onContextMenu(_fileValue5, event);
				}}
			>
				<button
					type="button"
					title={props.node ? undefined : file()?.path}
					data-git-file-select
					{...stylex.attrs(
						props.node ? styles.treeNodeButton : styles.fileRowButton,
					)}
					onPointerDown={(event) => {
						if (event.button === 0 && event.isPrimary) selectTreeNode();
					}}
					onClick={(event) => {
						if (event.detail === 0) selectTreeNode();
					}}
				>
					{isDir() && props.node ? (
						<>
							<IconChevronRight
								size={iconSize.sm}
								{...stylex.attrs(
									styles.chevron,
									isExpanded() && styles.chevronOpen,
								)}
							/>
							<IconFolderFill
								size={iconSize.md}
								{...stylex.attrs(
									styles.folderIcon,
									isExpanded() && styles.folderIconOpen,
								)}
							/>
							<span {...stylex.attrs(styles.treeName)}>{props.node.name}</span>
						</>
					) : file() ? (
						<>
							{props.node && (
								<span {...stylex.attrs(styles.treeIndentSpacer)} />
							)}
							{props.node ? (
								<span
									{...stylex.attrs(
										styles.treeFileName,
										active() && styles.activeText,
									)}
								>
									{props.node.name}
								</span>
							) : (
								<span {...stylex.attrs(styles.fileButton)}>
									{separator() >= 0 && (
										<span {...stylex.attrs(styles.pathDirectory)}>
											{file()?.path.slice(0, separator())}
										</span>
									)}
									<span {...stylex.attrs(styles.pathFileName)}>
										{file()?.path.slice(Math.max(0, separator()))}
									</span>
								</span>
							)}
							{file()?.additions || file()?.deletions ? (
								<span
									{...stylex.attrs(
										styles.fileStats,
										hovered() && !!props.onAction && styles.fileStatsHidden,
									)}
								>
									{!!file()?.additions && (
										<span {...stylex.attrs(styles.addedText)}>
											+{file()!.additions}
										</span>
									)}
									{!!file()?.deletions && (
										<span {...stylex.attrs(styles.deletedText)}>
											-{file()!.deletions}
										</span>
									)}
								</span>
							) : null}
						</>
					) : null}
				</button>
				{file() && props.onAction && (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							props.onAction?.(file()!.path);
						}}
						{...stylex.attrs(
							props.node ? styles.rowAction : styles.rowActionSubtle,
							hovered() && styles.rowActionVisible,
						)}
						aria-label={ariaValue(`${props.actionLabel} ${file()!.path}`)}
					>
						{props.actionLabel === "Unstage" ? (
							<IconMinus size={11} />
						) : (
							<IconPlus size={11} />
						)}
					</button>
				)}
			</div>
			{isDir() && isExpanded() && (
				<For each={props.node?.children ?? []} keyed={(child) => child.path}>
					{(child) => (
						<TreeNodeRow
							{...props}
							node={child()}
							depth={(props.depth ?? 0) + 1}
						/>
					)}
				</For>
			)}
		</Show>
	);
}
