import * as stylex from "@octanejs/stylex";
import { useCallback, useEffect, useState } from "octane";
import { fetchJson } from "../../../../adapters/backend/http.ts";
import {
	iconSize,
	surfaceStyles,
} from "../../../../design-system/styles.stylex.ts";
import { IconChevronRight } from "../../../../shared/ui/Icons/index.tsx";
import type { ExplorerEntry } from "../../model/explorer-events.ts";
import { dispatchDocumentOpen } from "../../model/explorer-events.ts";
import { FileTypeIcon, FolderTypeIcon } from "../FileTypeIcon/index.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
export function Directory({
	cwd,
	path = "",
	depth = 0,
}: {
	cwd: string;
	path?: string;
	depth?: number;
}) {
	const [entries, setEntries] = useState<ExplorerEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [requestVersion, setRequestVersion] = useState(0);
	useEffect(() => {
		const controller = new AbortController();
		const params = new URLSearchParams({ cwd, path });
		setLoading(true);
		setError(null);
		fetchJson<{ entries: ExplorerEntry[] }>(`/api/files/list?${params}`, {
			signal: controller.signal,
		})
			.then((value) => setEntries(value.entries))
			.catch((reason) => {
				if (!controller.signal.aborted) {
					setEntries([]);
					setError(
						reason instanceof Error
							? reason.message
							: "Could not load this folder",
					);
				}
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [cwd, path, requestVersion]);
	if (loading) return <span {...stylex.props(styles.status)}>Loading…</span>;
	if (error)
		return (
			<button
				type="button"
				onClick={() => setRequestVersion((value) => value + 1)}
				{...stylex.props(styles.error)}
			>
				Could not load files · Retry
			</button>
		);
	if (!entries.length)
		return <span {...stylex.props(styles.status)}>Empty folder</span>;
	return (
		<div>
			{entries.map((entry) => (
				<Entry key={entry.path} entry={entry} depth={depth} />
			))}
		</div>
	);
}

const EXPLORER_ROW_HEIGHT = 24;

const PROJECT_HEADER_HEIGHT = 26;

export function Entry({
	entry,
	depth,
}: {
	entry: ExplorerEntry;
	depth: number;
}) {
	const [expanded, setExpanded] = useState(false);
	const activate = useCallback(() => {
		if (entry.isDir) setExpanded((value) => !value);
		else dispatchDocumentOpen({ cwd: entry.cwd, path: entry.path });
	}, [entry]);
	return (
		<div {...stylex.props(styles.entryGroup)}>
			<button
				type="button"
				onClick={activate}
				{...stylex.props(
					styles.row,
					surfaceStyles.explorerRow,
					entry.isDir && styles.stickyFolderRow,
					entry.isDir && surfaceStyles.stickyExplorerRow,
				)}
				style={inlineStyles.getEntryRowStyle(
					8 + depth * 14,
					entry.isDir
						? PROJECT_HEADER_HEIGHT + depth * EXPLORER_ROW_HEIGHT
						: undefined,
					entry.isDir ? 20 - Math.min(depth, 15) : undefined,
				)}
			>
				{entry.isDir ? (
					<IconChevronRight
						size={iconSize.xs}
						className={
							stylex.props(styles.chevron, expanded && styles.chevronOpen)
								.className
						}
					/>
				) : (
					<span {...stylex.props(styles.spacer)} />
				)}
				{entry.isDir ? (
					<FolderTypeIcon
						path={entry.path}
						open={expanded}
						size={iconSize.md}
					/>
				) : (
					<FileTypeIcon path={entry.path} size={iconSize.md} />
				)}
				<span {...stylex.props(styles.name)}>{entry.name}</span>
			</button>
			{expanded ? (
				<Directory cwd={entry.cwd} path={entry.path} depth={depth + 1} />
			) : null}
		</div>
	);
}
