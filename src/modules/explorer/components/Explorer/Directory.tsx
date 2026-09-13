import { iconSize, surfaceStyles } from "@design-system/styles.stylex.ts";
import {
	type ExplorerEntry,
	listDirectory,
} from "@explorer/services/explorerApi.ts";
import { useBackgroundQuery as useQuery } from "@shared/hooks/useQueryResource.tsx";
import {
	dispatchDocumentOpen,
	domStyle,
	queryClient,
} from "@shared/lib/dom.tsx";
import { IconChevronRight } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, Show } from "solid-js";
import { FileTypeIcon, FolderTypeIcon } from "../FileTypeIcon/index.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
export function Directory(_props: {
	cwd: string;
	path?: string;
	depth?: number;
}) {
	const query = useQuery(
		() => {
			const cwd = _props.cwd;
			const path = _props.path ?? "";
			return {
				queryKey: ["explorer-directory", cwd, path],
				queryFn: ({ signal }) => listDirectory(cwd, path, signal),
				staleTime: 0,
				retry: false,
				refetchOnReconnect: false,
				refetchOnWindowFocus: false,
			};
		},
		() => queryClient,
	);
	const entries = createMemo(() => query.data ?? []);
	return (
		<Show
			when={!query.isPending}
			fallback={<span {...stylex.attrs(styles.status)}>Loading…</span>}
		>
			<Show
				when={!query.error || entries().length > 0}
				fallback={
					<button
						type="button"
						onClick={() => void query.refetch()}
						{...stylex.attrs(styles.error)}
					>
						Could not load files · Retry
					</button>
				}
			>
				<div>
					<For
						each={entries()}
						keyed={(entry) => entry.path}
						fallback={
							<span {...stylex.attrs(styles.status)}>Empty folder</span>
						}
					>
						{(entry) => <Entry entry={entry()} depth={_props.depth ?? 0} />}
					</For>
				</div>
			</Show>
		</Show>
	);
}

const EXPLORER_ROW_HEIGHT = 24;
const PROJECT_HEADER_HEIGHT = 26;
export function Entry(_props2: { entry: ExplorerEntry; depth: number }) {
	const [expanded, setExpanded] = createSignal(false);
	const activate = () => {
		if (_props2.entry.isDir) setExpanded((value) => !value);
		else
			dispatchDocumentOpen({
				cwd: _props2.entry.cwd,
				path: _props2.entry.path,
			});
	};
	return (
		<div {...stylex.attrs(styles.entryGroup)}>
			<button
				type="button"
				onClick={activate}
				{...stylex.attrs(
					styles.row,
					surfaceStyles.explorerRow,
					_props2.entry.isDir && styles.stickyFolderRow,
					_props2.entry.isDir && surfaceStyles.stickyExplorerRow,
				)}
				style={domStyle(
					inlineStyles.getEntryRowStyle(
						8 + _props2.depth * 14,
						_props2.entry.isDir
							? PROJECT_HEADER_HEIGHT + _props2.depth * EXPLORER_ROW_HEIGHT
							: undefined,
						_props2.entry.isDir ? 20 - Math.min(_props2.depth, 15) : undefined,
					),
				)}
			>
				{_props2.entry.isDir ? (
					<IconChevronRight
						size={iconSize.xs}
						class={
							stylex.attrs(styles.chevron, expanded() && styles.chevronOpen)
								.class
						}
					/>
				) : (
					<span {...stylex.attrs(styles.spacer)} />
				)}
				{_props2.entry.isDir ? (
					<FolderTypeIcon
						path={_props2.entry.path}
						open={expanded()}
						size={iconSize.md}
					/>
				) : (
					<FileTypeIcon path={_props2.entry.path} size={iconSize.md} />
				)}
				<span {...stylex.attrs(styles.name)}>{_props2.entry.name}</span>
			</button>
			{expanded() ? (
				<Directory
					cwd={_props2.entry.cwd}
					path={_props2.entry.path}
					depth={_props2.depth + 1}
				/>
			) : null}
		</div>
	);
}
