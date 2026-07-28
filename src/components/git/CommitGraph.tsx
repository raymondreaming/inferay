import * as stylex from "@octanejs/stylex";
import { memo, useCallback, useEffect, useMemo, useState } from "octane";
import type { GraphNode, GraphRow } from "../../features/git/useGitGraph";
import { toggleBoolean } from "../../lib/data.ts";
import { readStoredJson, writeStoredJson } from "../../lib/stored-json.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";
import {
	CommitGraphLinesLayer,
	IconCheck,
	IconCloud,
	IconGitBranch,
	IconTag,
} from "../ui/Icons.tsx";

interface WipFile {
	path: string;
	status: string;
	staged: boolean;
}

interface CommitGraphProps {
	commits: GraphNode[];
	rows: GraphRow[];
	selectedHash?: string;
	onSelect?: (hash: string) => void;
	className?: string;
	wipFiles?: WipFile[];
	branch?: string;
}

interface ColumnVisibility {
	author: boolean;
	sha: boolean;
	date: boolean;
}

const ROW_HEIGHT = 28;
const COLUMN_WIDTH = 12;
const AVATAR_SIZE = 16;
const GRAPH_PADDING = 6;
const LINE_WIDTH = 2.5;
const AUTHOR_WIDTH = 136;
const SHA_WIDTH = 68;
const DATE_WIDTH = 100;
const REF_WIDTH = 112;
const COLUMN_PREFS_KEY = "commit-graph-columns-v5";
const DEFAULT_COLUMNS: ColumnVisibility = {
	author: true,
	sha: true,
	date: false,
};

function hexToRgba(hex: string, alpha: number) {
	const c = hex.replace("#", "");
	const n =
		c.length === 3
			? c
					.split("")
					.map((ch) => `${ch}${ch}`)
					.join("")
			: c;
	return `rgba(${Number.parseInt(n.slice(0, 2), 16)}, ${Number.parseInt(n.slice(2, 4), 16)}, ${Number.parseInt(n.slice(4, 6), 16)}, ${alpha})`;
}

interface ParsedRef {
	label: string;
	kind: "head" | "local" | "remote" | "tag";
}

function parseRefs(refs: string[]): ParsedRef[] {
	const out: ParsedRef[] = [];
	const localNames = new Set<string>();

	// First pass: collect local branch names
	for (const raw of refs) {
		if (raw.includes("HEAD -> ")) {
			localNames.add(raw.replace("HEAD -> ", ""));
		} else if (
			!raw.startsWith("origin/") &&
			!raw.startsWith("tag: ") &&
			raw !== "HEAD"
		) {
			localNames.add(raw);
		}
	}

	for (const raw of refs) {
		// Skip bare HEAD, origin/HEAD, and stash refs
		if (raw === "HEAD" || raw === "origin/HEAD" || raw.includes("stash"))
			continue;

		if (raw.includes("HEAD -> ")) {
			out.push({ label: raw.replace("HEAD -> ", ""), kind: "head" });
		} else if (raw.startsWith("tag: ")) {
			out.push({ label: raw.replace("tag: ", ""), kind: "tag" });
		} else if (raw.startsWith("origin/")) {
			// Skip remote ref if we already have the local branch
			const remoteName = raw.replace("origin/", "");
			if (localNames.has(remoteName)) continue;
			out.push({ label: raw, kind: "remote" });
		} else {
			out.push({ label: raw, kind: "local" });
		}
	}

	const order = { head: 0, local: 1, remote: 2, tag: 3 };
	out.sort((a, b) => order[a.kind] - order[b.kind]);
	return out;
}

function loadColumns(): ColumnVisibility {
	return {
		...DEFAULT_COLUMNS,
		...readStoredJson<Partial<ColumnVisibility>>(COLUMN_PREFS_KEY, {}),
	};
}

/** Small SVG icons for ref badges */
function RefIcon({ kind }: { kind: ParsedRef["kind"] }) {
	const size = 10;
	if (kind === "head") {
		return <IconCheck size={size} {...stylex.props(styles.shrink)} />;
	}
	if (kind === "tag") {
		return <IconTag size={size} {...stylex.props(styles.shrink)} />;
	}
	if (kind === "remote") {
		return <IconCloud size={size} {...stylex.props(styles.shrink)} />;
	}
	return <IconGitBranch size={size} {...stylex.props(styles.shrink)} />;
}

function RefBadge({
	label,
	color,
	kind,
}: {
	label: string;
	color: string;
	kind: ParsedRef["kind"];
}) {
	return (
		<span
			{...stylex.props(styles.refBadge)}
			style={{
				border: `1px solid ${hexToRgba(color, 0.28)}`,
				backgroundColor: hexToRgba(color, 0.1),
				color,
			}}
		>
			<RefIcon kind={kind} />
			<span {...stylex.props(styles.truncate)}>{label}</span>
		</span>
	);
}

function RefBadges({ refs, color }: { refs: string[]; color: string }) {
	const parsed = parseRefs(refs);
	if (!parsed.length) return null;
	const visible = parsed.slice(0, 1);
	const extra = parsed.length - 1;
	return (
		<div {...stylex.props(styles.refBadges)}>
			{visible.map((ref) => (
				<RefBadge
					key={ref.label}
					label={ref.label}
					color={color}
					kind={ref.kind}
				/>
			))}
			{extra > 0 && <span {...stylex.props(styles.refExtra)}>+{extra}</span>}
		</div>
	);
}

// ── Header ──────────────────────────────────────────────────────

function HeaderRow({
	graphWidth,
	columns,
	isColumnsOpen,
	onToggleColumnsMenu,
	onToggleColumn,
}: {
	graphWidth: number;
	columns: ColumnVisibility;
	isColumnsOpen: boolean;
	onToggleColumnsMenu: () => void;
	onToggleColumn: (key: keyof ColumnVisibility) => void;
}) {
	return (
		<div {...stylex.props(styles.header)}>
			<div
				{...stylex.props(styles.headerCell, styles.headerCellRight)}
				style={{ width: REF_WIDTH }}
			>
				Refs
			</div>
			<div {...stylex.props(styles.shrink)} style={{ width: graphWidth }} />
			<div {...stylex.props(styles.descriptionHeader)}>Description</div>
			{columns.author && (
				<div
					{...stylex.props(styles.headerCell, styles.headerCellBorder)}
					style={{ width: AUTHOR_WIDTH }}
				>
					Author
				</div>
			)}
			{columns.date && (
				<div
					{...stylex.props(styles.headerCell, styles.headerCellBorder)}
					style={{ width: DATE_WIDTH }}
				>
					Date
				</div>
			)}
			{columns.sha && (
				<div
					{...stylex.props(
						styles.headerCell,
						styles.headerCellBorder,
						styles.headerCellRight
					)}
					style={{ width: SHA_WIDTH }}
				>
					SHA
				</div>
			)}
			<div {...stylex.props(styles.columnsMenuRoot)}>
				<button
					type="button"
					onClick={onToggleColumnsMenu}
					{...stylex.props(styles.columnsButton)}
				>
					Cols
				</button>
				{isColumnsOpen && (
					<div {...stylex.props(styles.columnsMenu)}>
						{(
							[
								["author", "Author"],
								["sha", "SHA"],
								["date", "Date"],
							] as const
						).map(([key, label]) => (
							<button
								key={key}
								type="button"
								onClick={() => onToggleColumn(key)}
								{...stylex.props(styles.columnsMenuItem)}
							>
								{label}
								<span {...stylex.props(styles.columnsState)}>
									{columns[key] ? "On" : "Off"}
								</span>
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

// ── WIP Row ─────────────────────────────────────────────────────

const WipRow = memo(function WipRow({
	graphWidth,
	selected,
	onSelect,
	fileCount,
	branch,
	columns,
}: {
	graphWidth: number;
	selected: boolean;
	onSelect?: (hash: string) => void;
	fileCount: number;
	branch?: string;
	columns: ColumnVisibility;
}) {
	const nodeLeft = GRAPH_PADDING + COLUMN_WIDTH / 2 - AVATAR_SIZE / 2;
	const nodeTop = ROW_HEIGHT / 2 - AVATAR_SIZE / 2;
	const handleClick = useCallback(() => onSelect?.("wip"), [onSelect]);

	return (
		<button
			type="button"
			{...stylex.props(styles.graphRow)}
			style={{
				height: ROW_HEIGHT,
				backgroundColor: selected
					? "rgba(249,115,22,0.08)"
					: "rgba(249,115,22,0.025)",
			}}
			onClick={handleClick}
		>
			{selected && <div {...stylex.props(styles.wipAccentBar)} />}

			{/* Ref gutter */}
			<div {...stylex.props(styles.refGutter)} style={{ width: REF_WIDTH }}>
				<RefBadge label={`WIP ${branch ?? ""}`} color="#f97316" kind="local" />
			</div>

			{/* Graph cell: dashed circle node */}
			<div {...stylex.props(styles.graphCell)} style={{ width: graphWidth }}>
				<div
					{...stylex.props(styles.wipNode)}
					style={{
						left: nodeLeft,
						top: nodeTop,
						borderColor: "#f97316",
					}}
				>
					<div
						{...stylex.props(styles.wipNodeInner)}
						style={{ backgroundColor: "rgba(249,115,22,0.45)" }}
					/>
				</div>
			</div>

			{/* Message */}
			<div {...stylex.props(styles.messageCell)}>
				<span {...stylex.props(styles.commitMessage)}>Uncommitted changes</span>
				<span {...stylex.props(styles.fileCount)}>
					{fileCount} file{fileCount === 1 ? "" : "s"}
				</span>
			</div>

			{columns.author && (
				<div
					{...stylex.props(styles.authorCell)}
					style={{ width: AUTHOR_WIDTH }}
				>
					<div {...stylex.props(styles.wipAvatar)} />
					<span {...stylex.props(styles.truncate)}>Workspace</span>
				</div>
			)}
			{columns.date && (
				<div {...stylex.props(styles.metaCell)} style={{ width: DATE_WIDTH }}>
					Now
				</div>
			)}
			{columns.sha && (
				<div {...stylex.props(styles.shaCell)} style={{ width: SHA_WIDTH }}>
					---
				</div>
			)}
			<div {...stylex.props(styles.rowEndPad)} />
		</button>
	);
});

// ── Commit Row ──────────────────────────────────────────────────

const CommitRow = memo(function CommitRow({
	commit,
	graphWidth,
	selected,
	onSelect,
	columns,
	index,
}: {
	commit: GraphNode;
	graphWidth: number;
	selected: boolean;
	onSelect?: (hash: string) => void;
	columns: ColumnVisibility;
	index: number;
}) {
	const nodeLeft =
		GRAPH_PADDING +
		commit.column * COLUMN_WIDTH +
		COLUMN_WIDTH / 2 -
		AVATAR_SIZE / 2;
	const nodeTop = ROW_HEIGHT / 2 - AVATAR_SIZE / 2;
	const hasRefs = commit.refs.length > 0;
	const handleClick = useCallback(
		() => onSelect?.(commit.hash),
		[commit.hash, onSelect]
	);

	return (
		<button
			type="button"
			{...stylex.props(styles.graphRow)}
			style={{
				height: ROW_HEIGHT,
				backgroundColor: selected
					? "rgba(255,255,255,0.035)"
					: index % 2 === 1
						? "rgba(255,255,255,0.012)"
						: undefined,
			}}
			onClick={handleClick}
		>
			{/* Selected accent bar */}
			{selected && (
				<div
					{...stylex.props(styles.selectedAccentBar)}
					style={{ backgroundColor: commit.color }}
				/>
			)}

			{/* Ref gutter */}
			<div {...stylex.props(styles.refGutter)} style={{ width: REF_WIDTH }}>
				{hasRefs ? <RefBadges refs={commit.refs} color={commit.color} /> : null}
			</div>

			{/* Graph cell: avatar node on the line */}
			<div {...stylex.props(styles.graphCell)} style={{ width: graphWidth }}>
				<img
					src={commit.authorAvatarUrl}
					alt=""
					{...stylex.props(styles.graphAvatar)}
					style={{
						left: nodeLeft,
						top: nodeTop,
						border: `2.5px solid ${commit.color}`,
						boxShadow: `0 0 6px ${hexToRgba(commit.color, 0.25)}`,
					}}
				/>
			</div>

			{/* Commit message + author */}
			<div {...stylex.props(styles.messageCell)}>
				<div {...stylex.props(styles.commitMessage)}>{commit.message}</div>
			</div>

			{columns.author && (
				<div
					{...stylex.props(styles.authorCell)}
					style={{ width: AUTHOR_WIDTH }}
				>
					<img
						src={commit.authorAvatarUrl}
						alt=""
						{...stylex.props(styles.authorAvatar)}
					/>
					<span {...stylex.props(styles.authorName)}>{commit.author}</span>
				</div>
			)}
			{columns.date && (
				<div {...stylex.props(styles.metaCell)} style={{ width: DATE_WIDTH }}>
					{commit.date}
				</div>
			)}
			{columns.sha && (
				<div {...stylex.props(styles.shaCell)} style={{ width: SHA_WIDTH }}>
					{commit.hash}
				</div>
			)}
			<div {...stylex.props(styles.rowEndPad)} />
		</button>
	);
});

// ── Connection types & path building ────────────────────────────

interface RowTransition {
	row: number;
	fromCol: number;
	toCol: number;
	color: string;
}

function colX(col: number): number {
	return REF_WIDTH + GRAPH_PADDING + col * COLUMN_WIDTH + COLUMN_WIDTH / 2;
}

function rowY(row: number): number {
	return row * ROW_HEIGHT + ROW_HEIGHT / 2;
}

function rowTop(row: number): number {
	return row * ROW_HEIGHT + 1;
}

function rowBottom(row: number): number {
	return (row + 1) * ROW_HEIGHT - 1;
}

function buildConnection(conn: RowTransition): string {
	const x1 = colX(conn.fromCol);
	const y1 = rowY(conn.row);
	const x2 = colX(conn.toCol);
	const elbowY = y1 + ROW_HEIGHT * 0.36;
	const endY = rowY(conn.row + 1);
	const direction = x2 > x1 ? 1 : -1;
	const radius = 3;

	return [
		`M ${x1} ${y1}`,
		`L ${x1} ${elbowY - radius}`,
		`Q ${x1} ${elbowY} ${x1 + direction * radius} ${elbowY}`,
		`L ${x2 - direction * radius} ${elbowY}`,
		`Q ${x2} ${elbowY} ${x2} ${elbowY + radius}`,
		`L ${x2} ${endY}`,
	].join(" ");
}

// ── Main component ──────────────────────────────────────────────

export const CommitGraph = memo(function CommitGraph({
	commits,
	rows,
	selectedHash,
	onSelect,
	className = "",
	wipFiles = [],
	branch,
}: CommitGraphProps) {
	const [columns, setColumns] = useState<ColumnVisibility>(loadColumns);
	const [isColumnsOpen, setIsColumnsOpen] = useState(false);
	const hasWip = wipFiles.length > 0;
	const wipOffset = hasWip ? 1 : 0;

	useEffect(() => {
		writeStoredJson(COLUMN_PREFS_KEY, columns);
	}, [columns]);

	const maxColumn = useMemo(() => {
		let max = 0;
		for (const c of commits) if (c.column > max) max = c.column;
		return max;
	}, [commits]);

	const graphWidth = (maxColumn + 1) * COLUMN_WIDTH + GRAPH_PADDING * 2;
	const totalHeight = (commits.length + wipOffset) * ROW_HEIGHT;

	const toggleColumn = (key: keyof ColumnVisibility) =>
		setColumns((cur) => ({ ...cur, [key]: !cur[key] }));

	const railSegments = useMemo(() => {
		const segments: Array<{
			key: string;
			row: number;
			column: number;
			color: string;
		}> = [];
		for (const row of rows) {
			for (const rail of row.rails) {
				segments.push({
					key: `rail-${row.row + wipOffset}-${rail.column}`,
					row: row.row + wipOffset,
					column: rail.column,
					color: rail.color,
				});
			}
		}
		if (hasWip && commits.length > 0) {
			segments.unshift({
				key: "rail-wip-0",
				row: 0,
				column: 0,
				color: commits[0]!.color,
			});
		}
		return segments;
	}, [rows, wipOffset, hasWip, commits]);

	const transitions = useMemo(() => {
		const result: RowTransition[] = [];
		for (const row of rows) {
			for (const transition of row.transitions) {
				result.push({
					row: row.row + wipOffset,
					fromCol: transition.fromColumn,
					toCol: transition.toColumn,
					color: transition.color,
				});
			}
		}
		if (hasWip && commits.length > 0) {
			result.unshift({
				row: 0,
				fromCol: 0,
				toCol: commits[0]!.column,
				color: commits[0]!.color,
			});
		}
		return result;
	}, [rows, wipOffset, hasWip, commits]);

	if (!commits.length && !hasWip) {
		const emptyProps = stylex.props(styles.emptyRoot);
		return (
			<div
				{...emptyProps}
				className={`${emptyProps.className ?? ""} ${className}`}
			>
				<p {...stylex.props(styles.emptyText)}>No commits</p>
			</div>
		);
	}

	const rootProps = stylex.props(styles.root);
	return (
		<div {...rootProps} className={`${rootProps.className ?? ""} ${className}`}>
			<HeaderRow
				graphWidth={graphWidth}
				columns={columns}
				isColumnsOpen={isColumnsOpen}
				onToggleColumnsMenu={setIsColumnsOpen.bind(null, toggleBoolean)}
				onToggleColumn={toggleColumn}
			/>

			{/* SVG lines layer — clipped to ref+graph area */}
			<CommitGraphLinesLayer
				className={stylex.props(styles.linesLayer).className}
				width={REF_WIDTH + graphWidth}
				height={totalHeight}
				style={{ zIndex: 1 }}
				railSegments={railSegments}
				transitions={transitions}
				colX={colX}
				rowTop={rowTop}
				rowBottom={rowBottom}
				buildConnection={buildConnection}
				lineWidth={LINE_WIDTH}
			/>

			{/* Rows layer — avatar nodes sit on top of lines */}
			<div {...stylex.props(styles.rowsLayer)}>
				{hasWip && (
					<WipRow
						graphWidth={graphWidth}
						selected={selectedHash === "wip"}
						onSelect={onSelect}
						fileCount={wipFiles.length}
						branch={branch}
						columns={columns}
					/>
				)}
				{commits.map((commit, i) => (
					<CommitRow
						key={commit.hash}
						commit={commit}
						graphWidth={graphWidth}
						selected={selectedHash === commit.hash}
						onSelect={onSelect}
						columns={columns}
						index={i}
					/>
				))}
			</div>
		</div>
	);
});

const styles = stylex.create({
	root: {
		position: "relative",
		overflow: "auto",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: "0.375rem",
		backgroundColor: color.background,
	},
	emptyRoot: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: "0.375rem",
		backgroundColor: color.background,
		paddingBlock: controlSize._8,
	},
	emptyText: {
		color: color.textMuted,
		fontSize: "0.6875rem",
	},
	shrink: {
		flexShrink: 0,
	},
	truncate: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	refBadge: {
		display: "inline-flex",
		height: controlSize._4,
		maxWidth: "100%",
		alignItems: "center",
		gap: controlSize._1,
		overflow: "hidden",
		borderRadius: "999px",
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		lineHeight: 1,
		paddingInline: "0.375rem",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	refBadges: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._1,
		overflow: "hidden",
	},
	refExtra: {
		flexShrink: 0,
		color: color.textMuted,
		fontSize: "0.5rem",
	},
	header: {
		position: "sticky",
		top: 0,
		zIndex: 10,
		display: "flex",
		height: controlSize._7,
		alignItems: "center",
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: "rgba(0, 0, 0, 0.95)",
		backdropFilter: "blur(8px)",
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: 600,
		letterSpacing: "0.16em",
		textTransform: "uppercase",
	},
	headerCell: {
		flexShrink: 0,
		paddingInline: controlSize._3,
	},
	headerCellRight: {
		textAlign: "right",
	},
	headerCellBorder: {
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
	},
	descriptionHeader: {
		minWidth: 0,
		flex: 1,
		paddingInline: controlSize._3,
	},
	columnsMenuRoot: {
		position: "relative",
		flexShrink: 0,
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
		paddingInline: controlSize._2,
	},
	columnsButton: {
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: {
			default: color.border,
			":hover": color.borderStrong,
		},
		borderRadius: "0.25rem",
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
		fontSize: "0.5rem",
		letterSpacing: "0.12em",
		paddingBlock: "0.125rem",
		paddingInline: "0.375rem",
		textTransform: "uppercase",
	},
	columnsMenu: {
		position: "absolute",
		right: controlSize._2,
		top: controlSize._8,
		zIndex: 20,
		width: "7rem",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: "0.375rem",
		backgroundColor: color.backgroundRaised,
		boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.6)",
		padding: controlSize._1,
	},
	columnsMenuItem: {
		display: "flex",
		width: "100%",
		alignItems: "center",
		justifyContent: "space-between",
		borderRadius: "0.25rem",
		color: color.textSoft,
		fontSize: font.size_2,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		textAlign: "left",
		backgroundColor: {
			default: "transparent",
			":hover": color.controlHover,
		},
	},
	columnsState: {
		color: color.textMuted,
	},
	linesLayer: {
		position: "absolute",
		left: 0,
		top: controlSize._7,
		pointerEvents: "none",
	},
	rowsLayer: {
		position: "relative",
		zIndex: 2,
	},
	graphRow: {
		position: "relative",
		display: "flex",
		width: "100%",
		borderWidth: 0,
		cursor: "pointer",
		alignItems: "center",
		color: "inherit",
		font: "inherit",
		padding: 0,
		textAlign: "left",
		transitionProperty: "background-color",
		transitionDuration: "120ms",
		":hover": {
			backgroundColor: color.backgroundRaised,
		},
	},
	wipAccentBar: {
		position: "absolute",
		left: 0,
		top: 0,
		width: 3,
		height: "100%",
		backgroundColor: "#f97316",
	},
	selectedAccentBar: {
		position: "absolute",
		left: 0,
		top: 0,
		width: 3,
		height: "100%",
	},
	refGutter: {
		display: "flex",
		height: "100%",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "flex-end",
		overflow: "hidden",
		paddingInline: controlSize._2,
	},
	graphCell: {
		position: "relative",
		height: "100%",
		flexShrink: 0,
	},
	wipNode: {
		position: "absolute",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		width: AVATAR_SIZE,
		height: AVATAR_SIZE,
		borderWidth: 2,
		borderStyle: "dashed",
		borderRadius: "999px",
		backgroundColor: "var(--color-inferay-black)",
		boxShadow: "0 0 6px rgba(249,115,22,0.2)",
		zIndex: 3,
	},
	wipNodeInner: {
		width: controlSize._2,
		height: controlSize._2,
		borderRadius: "999px",
	},
	messageCell: {
		display: "flex",
		minWidth: 0,
		flex: 1,
		alignItems: "center",
		gap: controlSize._2,
		paddingInline: controlSize._3,
	},
	commitMessage: {
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textSoft,
		fontSize: "0.6875rem",
		lineHeight: 1,
	},
	fileCount: {
		flexShrink: 0,
		color: color.textMuted,
		fontSize: font.size_2,
	},
	authorCell: {
		display: "flex",
		height: "100%",
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._2,
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
		color: color.textMuted,
		fontSize: font.size_2,
		paddingInline: controlSize._3,
	},
	wipAvatar: {
		width: controlSize._4,
		height: controlSize._4,
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: "rgba(249, 115, 22, 0.7)",
		borderRadius: "999px",
	},
	metaCell: {
		display: "flex",
		height: "100%",
		flexShrink: 0,
		alignItems: "center",
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
		color: color.textMuted,
		fontSize: font.size_2,
		paddingInline: controlSize._3,
	},
	shaCell: {
		display: "flex",
		height: "100%",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "flex-end",
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
		color: color.textMuted,
		fontFamily:
			"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
		fontSize: font.size_2,
		paddingInline: controlSize._3,
	},
	rowEndPad: {
		flexShrink: 0,
		width: 38,
	},
	graphAvatar: {
		position: "absolute",
		width: AVATAR_SIZE,
		height: AVATAR_SIZE,
		borderRadius: "999px",
		backgroundColor: "var(--color-inferay-black)",
		zIndex: 3,
	},
	authorAvatar: {
		width: controlSize._4,
		height: controlSize._4,
		flexShrink: 0,
		borderRadius: "999px",
	},
	authorName: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_2,
	},
});
