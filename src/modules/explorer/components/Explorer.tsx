import * as stylex from "@octanejs/stylex";
import { useCallback, useEffect, useState } from "octane";
import { fetchJson } from "../../../adapters/backend/http.ts";
import {
	color,
	controlSize,
	font,
	iconSize,
	layer,
	motion,
	radius,
	surfaceStyles,
} from "../../../design-system/styles.stylex.ts";
import { dispatchDocumentOpen } from "../../../modules/explorer/model/explorer-events.ts";
import { IconChevronRight } from "../../../shared/ui/Icons.tsx";
import { FileTypeIcon, FolderTypeIcon } from "./FileTypeIcon.tsx";

type ExplorerEntry = {
	readonly cwd: string;
	readonly isDir: boolean;
	readonly name: string;
	readonly path: string;
};

const EXPLORER_ROW_HEIGHT = 24;
const PROJECT_HEADER_HEIGHT = 26;

function Directory({
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

function Entry({ entry, depth }: { entry: ExplorerEntry; depth: number }) {
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
				style={{
					paddingLeft: 8 + depth * 14,
					top: entry.isDir
						? PROJECT_HEADER_HEIGHT + depth * EXPLORER_ROW_HEIGHT
						: undefined,
					zIndex: entry.isDir ? 20 - Math.min(depth, 15) : undefined,
				}}
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

export function Explorer({ cwds }: { readonly cwds: readonly string[] }) {
	if (!cwds.length)
		return (
			<div {...stylex.props(styles.empty)}>
				Open a project in a chat to browse its files.
			</div>
		);
	return (
		<div
			data-workspace-explorer="true"
			onWheelCapture={(event) => {
				if (event.deltaY === 0) return;
				event.preventDefault();
				event.stopPropagation();
				event.currentTarget.scrollTop += event.deltaY;
			}}
			{...stylex.props(styles.root)}
		>
			{cwds.map((cwd) => (
				<section key={cwd} {...stylex.props(styles.project)}>
					<header {...stylex.props(surfaceStyles.panel, styles.projectName)}>
						<FolderTypeIcon path={cwd} open size={iconSize.md} />
						<span>{cwd.split("/").filter(Boolean).pop() || cwd}</span>
					</header>
					<Directory cwd={cwd} />
				</section>
			))}
		</div>
	);
}

const styles = stylex.create({
	root: {
		boxSizing: "border-box",
		flex: 1,
		minHeight: controlSize._0,
		overflowY: "auto",
		overscrollBehavior: "contain",
		paddingTop: controlSize._0,
		paddingBottom: controlSize._1,
		paddingInline: controlSize._3,
	},
	project: { marginBottom: controlSize._1 },
	projectName: {
		boxSizing: "border-box",
		borderRadius: radius.md,
		position: "sticky",
		top: controlSize._0,
		zIndex: layer.sticky,
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
		height: 26,
		paddingInline: controlSize._2,
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
	},
	entryGroup: { position: "relative" },
	row: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._1,
		width: "100%",
		height: controlSize._6,
		paddingRight: controlSize._2,
		borderRadius: radius.sm,
		color: { default: color.textMain, ":hover": color.textMain },
		textAlign: "left",
	},
	stickyFolderRow: {
		position: "sticky",
	},
	chevron: {
		flexShrink: 0,
		color: color.textSoft,
		transitionDuration: motion.durationFast,
		transitionProperty: "transform",
	},
	chevronOpen: { transform: "rotate(90deg)" },
	spacer: { width: controlSize._3, flexShrink: 0 },
	name: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		fontSize: font.size_2,
	},
	status: {
		display: "block",
		paddingBlock: controlSize._2,
		paddingLeft: controlSize._8,
		color: color.textMuted,
		fontSize: font.size_1,
	},
	error: {
		display: "block",
		paddingBlock: controlSize._2,
		paddingLeft: controlSize._8,
		color: color.danger,
		fontSize: font.size_1,
		textAlign: "left",
	},
	empty: {
		padding: controlSize._4,
		color: color.textMuted,
		fontSize: font.size_2,
		lineHeight: 1.5,
	},
});
