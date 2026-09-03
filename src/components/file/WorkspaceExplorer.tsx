import * as stylex from "@octanejs/stylex";
import { useCallback, useEffect, useState } from "octane";
import { iconSize } from "../../design-system.ts";
import { dispatchWorkspaceFileOpen } from "../../features/files/workspace-file-events.ts";
import { fetchJson } from "../../lib/fetch-json.ts";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
} from "../../tokens.stylex.ts";
import { IconChevronRight, IconFolder } from "../ui/Icons.tsx";
import { FileTypeIcon } from "./FileTypeIcon.tsx";

type ExplorerEntry = {
	readonly cwd: string;
	readonly isDir: boolean;
	readonly name: string;
	readonly path: string;
};

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
		else dispatchWorkspaceFileOpen({ cwd: entry.cwd, path: entry.path });
	}, [entry]);
	return (
		<>
			<button
				type="button"
				onClick={activate}
				{...stylex.props(styles.row)}
				style={{ paddingLeft: 8 + depth * 14 }}
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
					<IconFolder size={iconSize.md} />
				) : (
					<FileTypeIcon path={entry.path} size={iconSize.md} />
				)}
				<span {...stylex.props(styles.name)}>{entry.name}</span>
			</button>
			{expanded ? (
				<Directory cwd={entry.cwd} path={entry.path} depth={depth + 1} />
			) : null}
		</>
	);
}

export function WorkspaceExplorer({
	cwds,
}: {
	readonly cwds: readonly string[];
}) {
	if (!cwds.length)
		return (
			<div {...stylex.props(styles.empty)}>
				Open a project in a chat to browse its files.
			</div>
		);
	return (
		<div {...stylex.props(styles.root)}>
			{cwds.map((cwd) => (
				<section key={cwd} {...stylex.props(styles.project)}>
					<header {...stylex.props(styles.projectName)}>
						<IconFolder size={iconSize.md} />
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
		flex: 1,
		minHeight: controlSize._0,
		overflowY: "auto",
		overscrollBehavior: "contain",
		paddingBlock: controlSize._1,
	},
	project: { marginBottom: controlSize._3 },
	projectName: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
		padding: controlSize._2,
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
	},
	row: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._1_5,
		width: "100%",
		height: controlSize._7,
		paddingRight: controlSize._2,
		borderRadius: radius.sm,
		color: { default: color.textSoft, ":hover": color.textMain },
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		textAlign: "left",
	},
	chevron: {
		flexShrink: 0,
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
