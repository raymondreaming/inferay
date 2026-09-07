import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { GitFileEntry } from "../../../../../../build/presentation/contracts/GitFileEntry.ts";
import type { GitFileTreeNode } from "../../../../../../build/presentation/contracts/GitFileTreeNode.ts";
import { iconSize } from "../../../../../design-system/styles.stylex.ts";
import { ariaValue, domStyle } from "../../../../../shared/lib/dom.tsx";
import {
	IconChevronRight,
	IconFolderFill,
} from "../../../../../shared/ui/Icons/index.tsx";
import { FileActionIcon } from "./FileActionIcon.tsx";
import { FileChangeIcon } from "./FileChangeIcon.tsx";
import { FileDiffStats } from "./FileDiffStats.tsx";
import type { SelectedFile } from "./index.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
export function TreeNodeRow(props: {
	node?: GitFileTreeNode;
	pathFile?: GitFileEntry;
	visibleFiles: Map<string, GitFileEntry>;
	visibleCounts: Uint32Array;
	depth?: number;
	selected: SelectedFile | null;
	onPrefetchFile?: (file: GitFileEntry | null) => void;
	onSelect: (f: GitFileEntry) => void;
	onAction?: (path: string) => void;
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
			_sourceValue3.selected?.staged === _fileValue.staged
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
				style={domStyle(
					props.node
						? inlineStyles.getTreeNodeRowTreeRowStyle(
								`${4 + (props.depth === undefined ? 0 : props.depth) * 9}px`,
							)
						: undefined,
				)}
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
							<FileChangeIcon file={file()!} />
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
										{(() => {
											const _separatorValue2 = separator(),
												_fileValue4 = file();
											if (!_fileValue4) return null;
											return _separatorValue2 >= 0
												? _fileValue4.path.slice(_separatorValue2)
												: _fileValue4.path;
										})()}
									</span>
								</span>
							)}
							{file() && !hovered() ? <FileDiffStats file={file()!} /> : null}
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
						<FileActionIcon actionLabel={props.actionLabel} />
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
