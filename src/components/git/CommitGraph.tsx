import * as stylex from "@octanejs/stylex";
import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "octane";
import {
	resolveGitAuthorAvatar,
	resolveGitCommitAvatars,
} from "../../features/git/git-avatar.ts";
import {
	adjacentCommitOnBranch,
	buildGraphConnectionPath,
	buildGraphConvergencePath,
	collectReachableCommitIds,
	type GraphColumnKey,
	type GraphPresentationTransition,
	graphVirtualRange,
	matchesGraphSearch,
	moveGraphColumn,
	nearestContainingBranches,
	pinnedGraphColumnOrder,
} from "../../features/git/git-graph-presentation.ts";
import type {
	GitGraphRef,
	GitGraphRefKind,
	GitWorktree,
	GraphNode,
	GraphRow,
} from "../../features/git/useGitGraph";
import { toggleBoolean } from "../../lib/data.ts";
import { lockPointerSelection } from "../../lib/pointer-selection-lock.ts";
import { readStoredJson, writeStoredJson } from "../../lib/stored-json.ts";
import {
	color,
	controlSize,
	font,
	layer,
	palette,
	radius,
	shadow,
} from "../../tokens.stylex.ts";
import {
	CommitGraphLinesLayer,
	IconCheck,
	IconCloud,
	IconGitBranch,
	IconGitCommit,
	IconSearch,
	IconSettings,
	IconTag,
} from "../ui/Icons.tsx";

interface CommitGraphProps {
	commits: GraphNode[];
	rows: GraphRow[];
	selectedHash?: string;
	selectedIds?: readonly string[];
	onSelect?: (itemId: string, intent?: GraphSelectionIntent) => void;
	className?: string;
	worktrees?: GitWorktree[];
	branch?: string;
	embedded?: boolean;
	onCheckoutRef?: (ref: string) => void;
	onRefDrop?: (source: string, target: string) => void;
	hasMore?: boolean;
	onLoadMore?: () => void;
	loadingMore?: boolean;
	repositoryKey?: string;
	onGraphAction?: (request: GitGraphActionRequest) => void;
	onCompareWithWip?: (itemId: string) => void;
}

export interface GraphSelectionIntent {
	additive: boolean;
	range: boolean;
}

export interface GitGraphActionRequest {
	action:
		| "createBranch"
		| "createTag"
		| "cherryPick"
		| "revert"
		| "stashPush"
		| "stashApply"
		| "stashPop"
		| "stashDrop"
		| "stashRename"
		| "renameBranch"
		| "deleteBranch"
		| "deleteTag"
		| "setUpstream"
		| "pushSetUpstream"
		| "deleteRemoteBranch"
		| "pushTag"
		| "deleteRemoteTag"
		| "forcePushWithLease"
		| "resetSoft"
		| "resetMixed"
		| "resetHard"
		| "fetch"
		| "pull"
		| "push";
	target?: string;
	targets?: string[];
	itemId: string;
	suggestedName?: string;
}

interface ColumnVisibility {
	author: boolean;
	sha: boolean;
	date: boolean;
}

type ColumnKey = GraphColumnKey;

interface ColumnWidths {
	date: number;
	refs: number;
	graph: number;
	message: number;
	author: number;
	sha: number;
}

interface GraphPreferences {
	columns: ColumnVisibility;
	widths: ColumnWidths;
	order: ColumnKey[];
	hiddenRefs: string[];
	soloRefs: string[];
	pinnedRefs: string[];
}

// Keep these literals static for StyleX extraction. The presentation module's
// defaults mirror this AIVRE-Core reference scale for non-renderer callers.
const ROW_HEIGHT = 23;
const COLUMN_WIDTH = 18;
const AVATAR_SIZE = 18;
const GRAPH_PADDING = 18;
const LINE_WIDTH = 2;
const ROW_OVERSCAN = 12;
const AUTHOR_WIDTH = 136;
const SHA_WIDTH = 76;
const DATE_WIDTH = 132;
const REF_WIDTH = 192;
const GRAPH_WIDTH = 360;
const MESSAGE_WIDTH = 340;
const TOOLS_WIDTH = 32;
const COLUMN_PREFS_KEY = "commit-graph-columns-v11";
const SCROLL_PREFS_KEY = "commit-graph-scroll-v1";
const DEFAULT_COLUMN_ORDER: ColumnKey[] = [
	"date",
	"refs",
	"graph",
	"message",
	"author",
	"sha",
];
const DEFAULT_COLUMNS: ColumnVisibility = {
	author: false,
	sha: true,
	date: true,
};
const DEFAULT_WIDTHS: ColumnWidths = {
	date: DATE_WIDTH,
	refs: REF_WIDTH,
	graph: GRAPH_WIDTH,
	message: MESSAGE_WIDTH,
	author: AUTHOR_WIDTH,
	sha: SHA_WIDTH,
};
const MIN_COLUMN_WIDTHS: ColumnWidths = {
	date: 84,
	refs: 96,
	graph: 48,
	message: 160,
	author: 88,
	sha: 56,
};
const MAX_COLUMN_WIDTH = 480;

function normalizedColumnWidths(
	stored: Partial<ColumnWidths> | undefined,
): ColumnWidths {
	return Object.fromEntries(
		(Object.keys(DEFAULT_WIDTHS) as Array<keyof ColumnWidths>).map((column) => {
			const candidate = stored?.[column];
			const value =
				typeof candidate === "number" && Number.isFinite(candidate)
					? candidate
					: DEFAULT_WIDTHS[column];
			return [
				column,
				Math.max(MIN_COLUMN_WIDTHS[column], Math.min(MAX_COLUMN_WIDTH, value)),
			];
		}),
	) as unknown as ColumnWidths;
}

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

function authorInitials(name?: string | null) {
	const words = (typeof name === "string" ? name : "")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	if (!words.length) return "?";
	if (words.length === 1) return words[0]!.slice(0, 2).toLocaleUpperCase();
	return `${words[0]![0] ?? ""}${words.at(-1)?.[0] ?? ""}`.toLocaleUpperCase();
}

function AuthorAvatar({
	name,
	email,
	githubAvatar,
	color,
	left,
	top,
	stash,
}: {
	name?: string | null;
	email?: string | null;
	githubAvatar?: string | null;
	color: string;
	left: number;
	top: number;
	stash: boolean;
}) {
	const [url, setUrl] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let current = true;
		setUrl(null);
		setFailed(false);
		if (githubAvatar !== undefined) {
			setUrl(githubAvatar);
		} else if (!stash) {
			void resolveGitAuthorAvatar(email, name).then((next) => {
				if (current) setUrl(next);
			});
		}
		return () => {
			current = false;
		};
	}, [email, githubAvatar, name, stash]);
	return (
		<span
			aria-hidden="true"
			{...stylex.props(styles.graphAvatar, stash && styles.stashNode)}
			style={{
				left,
				top,
				border: `1px solid ${color}`,
				boxShadow: `0 0 2px ${hexToRgba(color, 0.18)}`,
			}}
		>
			{url && !failed ? (
				<img
					src={url}
					alt=""
					loading="lazy"
					referrerPolicy="no-referrer"
					onError={() => setFailed(true)}
					{...stylex.props(styles.avatarImage)}
				/>
			) : stash ? (
				<IconGitCommit size={10} />
			) : (
				authorInitials(name)
			)}
		</span>
	);
}

function MergeNode({
	color,
	left,
	top,
}: {
	color: string;
	left: number;
	top: number;
}) {
	return (
		<span
			aria-hidden="true"
			data-graph-merge-node="true"
			{...stylex.props(styles.mergeNode)}
			style={{
				left: left + AVATAR_SIZE / 2 - 5,
				top: top + AVATAR_SIZE / 2 - 5,
				backgroundColor: color,
				boxShadow: `0 0 0 1px ${hexToRgba(color, 0.32)}`,
			}}
		/>
	);
}

function formatCommitDate(value: string, fallback: string) {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return fallback;
	return new Intl.DateTimeFormat("en-US", {
		month: "2-digit",
		day: "2-digit",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	})
		.format(parsed)
		.replace(",", " @");
}

function preferencesKey(repositoryKey?: string) {
	return `${COLUMN_PREFS_KEY}:${repositoryKey ?? "default"}`;
}

function scrollPreferencesKey(repositoryKey?: string) {
	return `${SCROLL_PREFS_KEY}:${repositoryKey ?? "default"}`;
}

function loadPreferences(repositoryKey?: string): GraphPreferences {
	const stored = readStoredJson<Partial<GraphPreferences>>(
		preferencesKey(repositoryKey),
		{},
	);
	const storedOrder = Array.isArray(stored.order)
		? stored.order.filter((value): value is ColumnKey =>
				DEFAULT_COLUMN_ORDER.includes(value),
			)
		: [];
	return {
		columns: { ...DEFAULT_COLUMNS, ...stored.columns },
		widths: normalizedColumnWidths(stored.widths),
		hiddenRefs: Array.isArray(stored.hiddenRefs) ? stored.hiddenRefs : [],
		soloRefs: Array.isArray(stored.soloRefs) ? stored.soloRefs : [],
		pinnedRefs: Array.isArray(stored.pinnedRefs) ? stored.pinnedRefs : [],
		order:
			storedOrder.length === DEFAULT_COLUMN_ORDER.length
				? storedOrder
				: DEFAULT_COLUMN_ORDER,
	};
}

/** Small SVG icons for ref badges */
function RefIcon({ kind }: { kind: GitGraphRefKind }) {
	const size = 10;
	if (kind === "head") {
		return <IconCheck size={size} {...stylex.props(styles.shrink)} />;
	}
	if (kind === "tag") {
		return <IconTag size={size} {...stylex.props(styles.shrink)} />;
	}
	if (kind === "remoteBranch") {
		return <IconCloud size={size} {...stylex.props(styles.shrink)} />;
	}
	if (kind === "stash") {
		return <IconGitCommit size={size} {...stylex.props(styles.shrink)} />;
	}
	return <IconGitBranch size={size} {...stylex.props(styles.shrink)} />;
}

function RefBadge({
	label,
	fullName,
	color,
	kind,
	onCheckout,
	onRefDrop,
	worktreePath,
	upstream,
	ahead,
	behind,
	trailingKinds = [],
	onOpenContextMenu,
	ghost = false,
}: {
	label: string;
	fullName: string;
	color: string;
	kind: GitGraphRefKind;
	onCheckout?: (ref: string) => void;
	onRefDrop?: (source: string, target: string) => void;
	worktreePath?: string;
	upstream?: string;
	ahead?: number;
	behind?: number;
	trailingKinds?: GitGraphRefKind[];
	onOpenContextMenu?: (event: MouseEvent) => void;
	ghost?: boolean;
}) {
	const [hovered, setHovered] = useState(false);
	const interactive =
		(kind === "localBranch" ||
			(kind === "head" && fullName.startsWith("refs/heads/"))) &&
		!!(onCheckout || onRefDrop);
	const keyboardActionable = interactive || Boolean(onOpenContextMenu);
	return (
		<span
			role={keyboardActionable ? "button" : undefined}
			data-ref-kind={kind}
			data-ref-ghost={ghost ? "true" : undefined}
			data-ref-hovered={hovered ? "true" : "false"}
			tabIndex={keyboardActionable ? 0 : undefined}
			draggable={interactive}
			title={
				ghost
					? `${label} — nearest containing branch${interactive ? "; double-click to check out" : ""}`
					: worktreePath
						? `${label} — checked out at ${worktreePath}`
						: upstream
							? `${label} — tracks ${upstream}${ahead || behind ? ` (${ahead ?? 0} ahead, ${behind ?? 0} behind)` : ""}`
							: interactive
								? `${label} — double-click to check out`
								: label
			}
			onDoubleClick={(event) => {
				if (!interactive) return;
				event.preventDefault();
				event.stopPropagation();
				onCheckout?.(label);
			}}
			onClick={(event) => {
				if (keyboardActionable) event.stopPropagation();
			}}
			onKeyDown={(event) => {
				if (interactive && event.key === "Enter") {
					event.preventDefault();
					event.stopPropagation();
					onCheckout?.(label);
					return;
				}
				if (
					onOpenContextMenu &&
					(event.key === "ContextMenu" ||
						(event.shiftKey && event.key === "F10"))
				) {
					event.preventDefault();
					event.stopPropagation();
					const bounds = event.currentTarget.getBoundingClientRect();
					onOpenContextMenu(
						new MouseEvent("contextmenu", {
							clientX: bounds.left + bounds.width / 2,
							clientY: bounds.bottom,
						}),
					);
				}
			}}
			onDragStart={(event) => {
				if (!interactive || !event.dataTransfer) return;
				event.stopPropagation();
				event.dataTransfer.effectAllowed = "move";
				event.dataTransfer.setData("application/x-inferay-git-ref", fullName);
				event.dataTransfer.setData("text/plain", label);
			}}
			onDragOver={(event) => {
				if (!interactive || !event.dataTransfer) return;
				const source = event.dataTransfer.getData(
					"application/x-inferay-git-ref",
				);
				if (!source || source === fullName) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = "move";
			}}
			onDrop={(event) => {
				if (!interactive || !event.dataTransfer) return;
				const source = event.dataTransfer.getData(
					"application/x-inferay-git-ref",
				);
				if (!source || source === fullName) return;
				event.preventDefault();
				event.stopPropagation();
				onRefDrop?.(
					source.replace(/^refs\/heads\//, ""),
					fullName.replace(/^refs\/heads\//, ""),
				);
			}}
			onContextMenu={(event) => {
				if (!onOpenContextMenu) return;
				event.preventDefault();
				event.stopPropagation();
				onOpenContextMenu(event);
			}}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onFocus={() => setHovered(true)}
			onBlur={() => setHovered(false)}
			{...stylex.props(styles.refBadge, ghost && styles.ghostRefBadge)}
			style={{
				border: "none",
				backgroundColor: ghost
					? hexToRgba(color, hovered ? 0.18 : 0.055)
					: hexToRgba(color, hovered ? 0.75 : 0.5),
				color: ghost ? color : palette.white,
			}}
		>
			{kind !== "remoteBranch" ? <RefIcon kind={kind} /> : null}
			<span {...stylex.props(styles.truncate)}>{label}</span>
			{kind === "remoteBranch" ? <RefIcon kind={kind} /> : null}
			{trailingKinds.map((trailingKind, index) => (
				<span
					key={`${trailingKind}:${index}`}
					aria-hidden="true"
					{...stylex.props(styles.shrink)}
				>
					<RefIcon kind={trailingKind} />
				</span>
			))}
			{ahead ? <span {...stylex.props(styles.refAhead)}>+{ahead}</span> : null}
			{behind ? (
				<span {...stylex.props(styles.refBehind)}>−{behind}</span>
			) : null}
		</span>
	);
}

/**
 * GitKraken presents remote refs as a branch name plus a provider glyph. Keep
 * the qualified displayName on the model for Git operations and accessibility,
 * and shorten it only at this visual boundary.
 */
function refPresentationLabel(ref: GitGraphRef): string {
	if (ref.kind !== "remoteBranch" || !ref.remoteName) return ref.displayName;
	const remotePrefix = `${ref.remoteName}/`;
	return ref.displayName.startsWith(remotePrefix)
		? ref.displayName.slice(remotePrefix.length)
		: ref.displayName;
}

function RefBadges({
	refs,
	color,
	onCheckout,
	onRefDrop,
	onOpenContextMenu,
}: {
	refs: GitGraphRef[];
	color: string;
	onCheckout?: (ref: string) => void;
	onRefDrop?: (source: string, target: string) => void;
	onOpenContextMenu?: (ref: GitGraphRef, event: MouseEvent) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	if (!refs.length) return null;
	const primary = refs[0]!;
	const primaryLabel = refPresentationLabel(primary);
	const companionRefs = refs
		.slice(1)
		.filter(
			(ref) =>
				ref.kind === "remoteBranch" &&
				primary.kind !== "remoteBranch" &&
				refPresentationLabel(ref) === primaryLabel,
		);
	const companionNames = new Set(companionRefs.map((ref) => ref.fullName));
	const overflowRefs = refs
		.slice(1)
		.filter((ref) => !companionNames.has(ref.fullName));
	const renderBadge = (ref: GitGraphRef, trailingKinds?: GitGraphRefKind[]) => (
		<RefBadge
			key={ref.fullName}
			label={refPresentationLabel(ref)}
			fullName={ref.fullName}
			color={color}
			kind={ref.kind}
			onCheckout={onCheckout}
			onRefDrop={onRefDrop}
			worktreePath={ref.worktreePath}
			upstream={ref.upstream}
			ahead={ref.ahead}
			behind={ref.behind}
			trailingKinds={trailingKinds}
			onOpenContextMenu={(event) => onOpenContextMenu?.(ref, event)}
		/>
	);
	return (
		<div
			onMouseEnter={() => refs.length > 1 && setExpanded(true)}
			onMouseLeave={() => {
				setExpanded(false);
			}}
			onFocus={() => refs.length > 1 && setExpanded(true)}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
					setExpanded(false);
				}
			}}
			{...stylex.props(styles.refBadges, expanded && styles.refBadgesOpen)}
		>
			{renderBadge(
				primary,
				companionRefs.map((ref) => ref.kind),
			)}
			{overflowRefs.length ? (
				<span
					data-ref-overflow={overflowRefs.length}
					title={`${overflowRefs.length} more references`}
					{...stylex.props(styles.refExtra)}
				>
					+{overflowRefs.length}
				</span>
			) : null}
			{expanded && refs.length > 1 ? (
				<div
					role="group"
					aria-label="Commit references"
					{...stylex.props(styles.refBadgeStack)}
				>
					{refs.slice(1).map((ref) => renderBadge(ref))}
				</div>
			) : null}
		</div>
	);
}

function ColumnResizeHandle({
	column,
	onResizeStart,
}: {
	column: keyof ColumnWidths;
	onResizeStart: (column: keyof ColumnWidths, event: PointerEvent) => void;
}) {
	return (
		<button
			type="button"
			aria-label={`Resize ${column} column`}
			onPointerDown={(event) => onResizeStart(column, event)}
			{...stylex.props(styles.columnResizeHandle)}
		/>
	);
}

// ── Header ──────────────────────────────────────────────────────

function HeaderRow({
	graphWidth,
	columns,
	widths,
	order,
	isColumnsOpen,
	onToggleColumnsMenu,
	onToggleColumn,
	onMoveColumn,
	onResizeStart,
	hiddenRefs,
	onShowRef,
	query,
	onQueryChange,
	matchCount,
}: {
	graphWidth: number;
	columns: ColumnVisibility;
	widths: ColumnWidths;
	order: ColumnKey[];
	isColumnsOpen: boolean;
	onToggleColumnsMenu: () => void;
	onToggleColumn: (key: keyof ColumnVisibility) => void;
	onMoveColumn: (source: ColumnKey, target: ColumnKey) => void;
	onResizeStart: (column: keyof ColumnWidths, event: PointerEvent) => void;
	hiddenRefs: GitGraphRef[];
	onShowRef: (fullName: string) => void;
	query: string;
	onQueryChange: (query: string) => void;
	matchCount: number;
}) {
	const visible = (column: ColumnKey) =>
		column !== "author" && column !== "sha" && column !== "date"
			? true
			: columns[column];
	const labels: Record<ColumnKey, string> = {
		date: "Commit date / time",
		refs: "Branch",
		graph: "Graph",
		message: "Commit message",
		author: "Author",
		sha: "SHA",
	};
	const columnWidth = (column: ColumnKey) =>
		column === "graph" ? graphWidth : widths[column];
	return (
		<div {...stylex.props(styles.header)}>
			{order.filter(visible).map((column) => (
				<div
					key={column}
					draggable
					onDragStart={(event) => {
						event.dataTransfer?.setData(
							"application/x-inferay-graph-column",
							column,
						);
					}}
					onDragOver={(event) => {
						if (
							Array.from(event.dataTransfer?.types ?? []).includes(
								"application/x-inferay-graph-column",
							)
						)
							event.preventDefault();
					}}
					onDrop={(event) => {
						const source = event.dataTransfer?.getData(
							"application/x-inferay-graph-column",
						) as ColumnKey;
						if (source && source !== column) onMoveColumn(source, column);
					}}
					{...stylex.props(
						styles.headerCell,
						styles.headerCellBorder,
						styles.draggableHeader,
					)}
					style={{ width: columnWidth(column) }}
				>
					{labels[column]}
					<ColumnResizeHandle column={column} onResizeStart={onResizeStart} />
				</div>
			))}
			<div {...stylex.props(styles.headerTools)} style={{ width: TOOLS_WIDTH }}>
				<div {...stylex.props(styles.columnsMenuRoot)}>
					<button
						type="button"
						onClick={onToggleColumnsMenu}
						aria-label="Graph columns and search"
						title="Graph columns and search"
						{...stylex.props(styles.columnsButton)}
					>
						<IconSettings size={11} />
					</button>
					{isColumnsOpen ? (
						<div {...stylex.props(styles.columnsMenu)}>
							<label {...stylex.props(styles.searchRoot)}>
								<IconSearch size={11} />
								<input
									type="search"
									value={query}
									onInput={(event) => onQueryChange(event.currentTarget.value)}
									placeholder="Search commits"
									aria-label="Search commits"
									title="Use author:, committer:, message:, ref:, or sha:"
									{...stylex.props(styles.searchInput)}
								/>
								{query ? (
									<span {...stylex.props(styles.searchCount)}>
										{matchCount}
									</span>
								) : null}
							</label>
							{(["author", "sha", "date"] as const).map((key) => (
								<button
									key={key}
									type="button"
									onClick={() => onToggleColumn(key)}
									{...stylex.props(styles.columnsMenuItem)}
								>
									{labels[key]}
									<span {...stylex.props(styles.columnsState)}>
										{columns[key] ? "On" : "Off"}
									</span>
								</button>
							))}
							{hiddenRefs.length ? (
								<>
									<div {...stylex.props(styles.columnsMenuSection)}>
										Hidden refs
									</div>
									{hiddenRefs.map((ref) => (
										<button
											key={ref.fullName}
											type="button"
											onClick={() => onShowRef(ref.fullName)}
											{...stylex.props(styles.columnsMenuItem)}
										>
											<span {...stylex.props(styles.truncate)}>
												{ref.displayName}
											</span>
											<span {...stylex.props(styles.columnsState)}>Show</span>
										</button>
									))}
								</>
							) : null}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}

// ── Commit Row ──────────────────────────────────────────────────

const CommitRow = memo(function CommitRow({
	commit,
	worktree,
	graphWidth,
	displayColumn,
	selected,
	onSelect,
	onCheckoutRef,
	onRefDrop,
	onOpenRefContextMenu,
	onOpenItemContextMenu,
	ghostRef,
	hiddenRefNames,
	pinnedRefNames,
	historyMatch,
	columns,
	widths,
	order,
	virtualTop,
	searchMatch,
	githubAvatar,
}: {
	commit: GraphNode;
	worktree?: GitWorktree;
	graphWidth: number;
	displayColumn: number;
	selected: boolean;
	onSelect?: (itemId: string, intent?: GraphSelectionIntent) => void;
	onCheckoutRef?: (ref: string) => void;
	onRefDrop?: (source: string, target: string) => void;
	onOpenRefContextMenu?: (ref: GitGraphRef, event: MouseEvent) => void;
	onOpenItemContextMenu?: (commit: GraphNode, event: MouseEvent) => void;
	ghostRef?: GitGraphRef;
	hiddenRefNames: ReadonlySet<string>;
	pinnedRefNames: ReadonlySet<string>;
	historyMatch: boolean;
	columns: ColumnVisibility;
	widths: ColumnWidths;
	order: ColumnKey[];
	virtualTop: number;
	searchMatch: boolean;
	githubAvatar?: string | null;
}) {
	const [rowActive, setRowActive] = useState(false);
	const nodeLeft =
		GRAPH_PADDING +
		displayColumn * COLUMN_WIDTH +
		COLUMN_WIDTH / 2 -
		AVATAR_SIZE / 2;
	const nodeTop = ROW_HEIGHT / 2 - AVATAR_SIZE / 2;
	const nodeCenter =
		GRAPH_PADDING + displayColumn * COLUMN_WIDTH + COLUMN_WIDTH / 2;
	const isWip = commit.itemKind === "worktreeWip";
	const isStash = commit.itemKind === "stash";
	const isMergeCommit = !isWip && !isStash && commit.parents.length > 1;
	const syntheticStashRef: GitGraphRef | null = isStash
		? {
				fullName: commit.stashName ?? "refs/stash",
				displayName: commit.stashName ?? "stash",
				kind: "stash",
				target: commit.hash,
				isHead: false,
			}
		: null;
	const allRefs =
		syntheticStashRef && !commit.refs.some((ref) => ref.kind === "stash")
			? [syntheticStashRef, ...commit.refs]
			: commit.refs;
	const visibleRefs = allRefs
		.filter((ref) => !hiddenRefNames.has(ref.fullName))
		.sort(
			(a, b) =>
				Number(pinnedRefNames.has(b.fullName)) -
				Number(pinnedRefNames.has(a.fullName)),
		);
	const hasRefs = visibleRefs.length > 0;
	const visibleGhostRef =
		ghostRef && !hiddenRefNames.has(ghostRef.fullName) ? ghostRef : undefined;
	const showGhostRef = !hasRefs && !!visibleGhostRef && (selected || rowActive);
	const fileCount = worktree?.status?.files.length ?? 0;
	const worktreeLabel = worktree?.branch ?? "detached HEAD";
	const showWipRef = isWip && worktree?.isCurrent === false;
	const handleSelect = useCallback(
		(intent?: GraphSelectionIntent) => onSelect?.(commit.id, intent),
		[commit.id, onSelect],
	);
	const visibleOrder = order.filter(
		(column) =>
			(column !== "date" || columns.date) &&
			(column !== "author" || columns.author) &&
			(column !== "sha" || columns.sha),
	);
	const graphOrderIndex = visibleOrder.indexOf("graph");
	const graphStart = visibleOrder
		.slice(0, graphOrderIndex)
		.reduce(
			(total, column) =>
				total + (column === "graph" ? graphWidth : widths[column]),
			0,
		);
	const nodeAnchoredWashLeft = graphStart + nodeCenter;

	return (
		<div
			role="option"
			aria-selected={selected}
			aria-label={
				isWip
					? `Uncommitted changes on ${worktreeLabel}, ${fileCount} files`
					: `${commit.message}, ${commit.author}, ${formatCommitDate(commit.committedAt, commit.date)}, ${(visibleRefs.length ? visibleRefs : visibleGhostRef ? [visibleGhostRef] : []).map((ref) => ref.displayName).join(", ")}`
			}
			data-graph-item={commit.id}
			data-graph-kind={commit.itemKind}
			data-graph-column={displayColumn}
			data-history-match={historyMatch ? "true" : "false"}
			data-search-match={searchMatch ? "true" : "false"}
			tabIndex={0}
			onMouseEnter={() => setRowActive(true)}
			onMouseLeave={() => setRowActive(false)}
			onFocus={() => setRowActive(true)}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
					setRowActive(false);
				}
			}}
			{...stylex.props(styles.graphRow, styles.virtualRow)}
			style={{
				height: ROW_HEIGHT,
				transform: `translateY(${virtualTop}px)`,
				opacity: searchMatch && historyMatch ? 1 : 0.22,
			}}
			onClick={(event) =>
				handleSelect({
					additive: event.metaKey || event.ctrlKey,
					range: event.shiftKey,
				})
			}
			onContextMenu={(event) => {
				event.preventDefault();
				onOpenItemContextMenu?.(commit, event);
			}}
			onKeyDown={(event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				handleSelect();
			}}
		>
			<span
				aria-hidden="true"
				data-graph-row-wash="true"
				data-graph-row-hovered={rowActive ? "true" : "false"}
				{...stylex.props(styles.nodeAnchoredRowWash)}
				style={{
					left: nodeAnchoredWashLeft,
					top: nodeTop,
					height: AVATAR_SIZE,
					backgroundColor: selected
						? "rgba(35, 67, 112, 0.55)"
						: hexToRgba(commit.color, rowActive ? 0.42 : 0.1),
				}}
			/>
			{visibleOrder.map((column) => {
				switch (column) {
					case "date": {
						const date = isWip
							? ""
							: formatCommitDate(commit.committedAt, commit.date);
						return (
							<div
								key={column}
								title={date}
								{...stylex.props(styles.metaCell)}
								style={{ width: widths.date }}
							>
								{date}
							</div>
						);
					}
					case "refs":
						return (
							<div
								key={column}
								{...stylex.props(styles.refGutter)}
								style={{ width: widths.refs }}
							>
								{showWipRef ? (
									<RefBadge
										label={worktreeLabel}
										fullName={commit.id}
										color={commit.color}
										kind="localBranch"
										worktreePath={commit.worktreePath}
									/>
								) : hasRefs ? (
									<RefBadges
										refs={visibleRefs}
										color={commit.color}
										onCheckout={onCheckoutRef}
										onRefDrop={onRefDrop}
										onOpenContextMenu={onOpenRefContextMenu}
									/>
								) : showGhostRef && visibleGhostRef ? (
									<RefBadge
										label={refPresentationLabel(visibleGhostRef)}
										fullName={visibleGhostRef.fullName}
										color={commit.color}
										kind={visibleGhostRef.kind}
										onCheckout={onCheckoutRef}
										onRefDrop={onRefDrop}
										ghost
									/>
								) : null}
								{showWipRef || hasRefs || showGhostRef ? (
									<span
										aria-hidden="true"
										{...stylex.props(styles.refConnector)}
										style={{ backgroundColor: commit.color }}
									/>
								) : null}
							</div>
						);
					case "graph":
						return (
							<div
								key={column}
								{...stylex.props(styles.graphCell)}
								style={{ width: graphWidth }}
							>
								{showWipRef || hasRefs || showGhostRef ? (
									<span
										aria-hidden="true"
										{...stylex.props(styles.refToNodeConnector)}
										style={{
											width: nodeCenter,
											backgroundColor: commit.color,
										}}
									/>
								) : null}
								{isWip ? (
									<span
										aria-hidden="true"
										{...stylex.props(styles.wipNode)}
										style={{
											left: nodeLeft,
											top: nodeTop,
											borderColor: commit.color,
										}}
									/>
								) : isMergeCommit ? (
									<MergeNode
										color={commit.color}
										left={nodeLeft}
										top={nodeTop}
									/>
								) : (
									<AuthorAvatar
										name={commit.author}
										email={commit.authorEmail}
										githubAvatar={githubAvatar}
										color={commit.color}
										left={nodeLeft}
										top={nodeTop}
										stash={isStash}
									/>
								)}
							</div>
						);
					case "message":
						return (
							<div
								key={column}
								{...stylex.props(styles.messageCell)}
								style={{
									width: widths.message,
									borderLeft: `1px solid ${commit.color}`,
								}}
							>
								<span
									{...stylex.props(styles.commitMessage)}
									style={{ maxWidth: commit.body ? "64%" : "100%" }}
								>
									{isWip
										? showWipRef
											? `// WIP ${worktreeLabel}`
											: "// WIP"
										: commit.message}
								</span>
								{!isWip && commit.body ? (
									<span {...stylex.props(styles.commitBody)}>
										— {commit.body.replace(/\s+/g, " ")}
									</span>
								) : null}
								{isWip ? (
									<span {...stylex.props(styles.fileCount)}>
										{fileCount} file{fileCount === 1 ? "" : "s"}
									</span>
								) : null}
							</div>
						);
					case "author":
						return (
							<div
								key={column}
								{...stylex.props(styles.authorCell)}
								style={{
									width: widths.author,
								}}
							>
								<span {...stylex.props(styles.authorName)}>
									{isWip ? "Workspace" : commit.author}
								</span>
							</div>
						);
					case "sha":
						return (
							<div
								key={column}
								title={isWip ? "Uncommitted changes" : commit.hash}
								{...stylex.props(styles.shaCell)}
								style={{
									width: widths.sha,
								}}
							>
								{isWip ? "" : commit.hash.slice(0, 7)}
							</div>
						);
				}
				return null;
			})}
			<div {...stylex.props(styles.rowEndPad)} style={{ width: TOOLS_WIDTH }} />
		</div>
	);
});

// ── Connection types & path building ────────────────────────────

type RowTransition = GraphPresentationTransition;

function rowTop(row: number): number {
	return row * ROW_HEIGHT;
}

function rowBottom(row: number): number {
	return (row + 1) * ROW_HEIGHT;
}

// ── Main component ──────────────────────────────────────────────

export const CommitGraph = memo(function CommitGraph({
	commits,
	rows,
	selectedHash,
	selectedIds = [],
	onSelect,
	className = "",
	worktrees = [],
	branch,
	embedded = false,
	onCheckoutRef,
	onRefDrop,
	hasMore = false,
	onLoadMore,
	loadingMore = false,
	repositoryKey,
	onGraphAction,
	onCompareWithWip,
}: CommitGraphProps) {
	const [columns, setColumns] = useState<ColumnVisibility>(
		() => loadPreferences(repositoryKey).columns,
	);
	const [widths, setWidths] = useState<ColumnWidths>(
		() => loadPreferences(repositoryKey).widths,
	);
	const [order, setOrder] = useState<ColumnKey[]>(
		() => loadPreferences(repositoryKey).order,
	);
	const [hiddenRefs, setHiddenRefs] = useState<string[]>(
		() => loadPreferences(repositoryKey).hiddenRefs,
	);
	const [soloRefs, setSoloRefs] = useState<string[]>(
		() => loadPreferences(repositoryKey).soloRefs,
	);
	const [pinnedRefs, setPinnedRefs] = useState<string[]>(
		() => loadPreferences(repositoryKey).pinnedRefs,
	);
	const [isColumnsOpen, setIsColumnsOpen] = useState(false);
	const [commitAvatars, setCommitAvatars] = useState<
		Record<string, string | null>
	>({});
	const avatarHashes = useMemo(
		() =>
			commits
				.filter((commit) => commit.itemKind === "commit")
				.slice(0, 100)
				.map((commit) => commit.hash),
		[commits],
	);
	useEffect(() => {
		let current = true;
		if (!repositoryKey || avatarHashes.length === 0) return;
		void resolveGitCommitAvatars(repositoryKey, avatarHashes).then(
			(avatars) => {
				if (current) setCommitAvatars(avatars);
			},
		);
		return () => {
			current = false;
		};
	}, [avatarHashes, repositoryKey]);
	const scrollerRef = useRef<HTMLDivElement | null>(null);
	const scrollWriteTimerRef = useRef<number | null>(null);
	const scrollPositionRef = useRef({ top: 0, left: 0 });
	const restoredScrollKeyRef = useRef<string | null>(null);
	const [scrollTop, setScrollTop] = useState(0);
	const [viewportHeight, setViewportHeight] = useState(600);
	const [query, setQuery] = useState("");
	const [refContextMenu, setRefContextMenu] = useState<{
		ref: GitGraphRef;
		x: number;
		y: number;
	} | null>(null);
	const [itemContextMenu, setItemContextMenu] = useState<{
		item: GraphNode;
		x: number;
		y: number;
	} | null>(null);
	const worktreesByPath = useMemo(
		() => new Map(worktrees.map((worktree) => [worktree.path, worktree])),
		[worktrees],
	);

	useEffect(() => {
		const preferences = loadPreferences(repositoryKey);
		setColumns(preferences.columns);
		setWidths(preferences.widths);
		setOrder(preferences.order);
		setHiddenRefs(preferences.hiddenRefs);
		setSoloRefs(preferences.soloRefs);
		setPinnedRefs(preferences.pinnedRefs);
	}, [repositoryKey]);
	useEffect(() => {
		const key = scrollPreferencesKey(repositoryKey);
		if (restoredScrollKeyRef.current === key || commits.length === 0) return;
		const position = readStoredJson<{ top?: number; left?: number }>(key, {});
		const scroller = scrollerRef.current;
		if (!scroller) return;
		restoredScrollKeyRef.current = key;
		const top = typeof position.top === "number" ? position.top : 0;
		const left = typeof position.left === "number" ? position.left : 0;
		scrollPositionRef.current = { top, left };
		scroller.scrollTop = top;
		scroller.scrollLeft = left;
		setScrollTop(top);
	}, [commits.length, repositoryKey]);
	useEffect(
		() => () => {
			if (scrollWriteTimerRef.current !== null) {
				window.clearTimeout(scrollWriteTimerRef.current);
			}
			writeStoredJson(
				scrollPreferencesKey(repositoryKey),
				scrollPositionRef.current,
			);
		},
		[repositoryKey],
	);
	useEffect(() => {
		if (!refContextMenu && !itemContextMenu) return;
		const close = () => {
			setRefContextMenu(null);
			setItemContextMenu(null);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") close();
		};
		window.addEventListener("pointerdown", close);
		window.addEventListener("keydown", closeOnEscape);
		return () => {
			window.removeEventListener("pointerdown", close);
			window.removeEventListener("keydown", closeOnEscape);
		};
	}, [itemContextMenu, refContextMenu]);

	useEffect(() => {
		writeStoredJson(preferencesKey(repositoryKey), {
			columns,
			widths,
			order,
			hiddenRefs,
			soloRefs,
			pinnedRefs,
		});
	}, [columns, hiddenRefs, order, pinnedRefs, repositoryKey, soloRefs, widths]);

	const repositoryRefs = useMemo(() => {
		const refs = new Map<string, GitGraphRef>();
		for (const commit of commits) {
			for (const ref of commit.refs) refs.set(ref.fullName, ref);
		}
		return refs;
	}, [commits]);
	const containingBranches = useMemo(
		() => nearestContainingBranches(commits, [...repositoryRefs.values()]),
		[commits, repositoryRefs],
	);
	const hiddenRefDetails = hiddenRefs
		.map((fullName) => repositoryRefs.get(fullName))
		.filter((ref): ref is GitGraphRef => Boolean(ref));
	const defaultRemoteName = Array.from(repositoryRefs.values()).find(
		(ref) => ref.kind === "remoteBranch" && ref.remoteName,
	)?.remoteName;
	const hiddenRefNames = useMemo(() => new Set(hiddenRefs), [hiddenRefs]);
	const pinnedRefNames = useMemo(() => new Set(pinnedRefs), [pinnedRefs]);
	const activeHistoryTargets = soloRefs
		.map((fullName) => repositoryRefs.get(fullName)?.target)
		.filter((target): target is string => Boolean(target));
	const reachableHistory = useMemo(
		() => collectReachableCommitIds(commits, activeHistoryTargets),
		[activeHistoryTargets.join("\n"), commits],
	);

	const maxColumn = useMemo(() => {
		let max = 0;
		for (const c of commits) if (c.column > max) max = c.column;
		return max;
	}, [commits]);
	const pinnedColumnOrder = useMemo(() => {
		const columns = pinnedRefs
			.map((fullName) => repositoryRefs.get(fullName)?.target)
			.filter((target): target is string => Boolean(target))
			.map(
				(target) =>
					commits.find(
						(commit) => commit.hash === target || commit.id === target,
					)?.column,
			)
			.filter((column): column is number => column !== undefined);
		return pinnedGraphColumnOrder(maxColumn, columns);
	}, [commits, maxColumn, pinnedRefs, repositoryRefs]);
	const graphColumnPositions = useMemo(
		() => new Map(pinnedColumnOrder.map((column, index) => [column, index])),
		[pinnedColumnOrder],
	);
	const displayGraphColumn = useCallback(
		(column: number) => graphColumnPositions.get(column) ?? column,
		[graphColumnPositions],
	);

	const graphWidth = Math.max(
		widths.graph,
		(maxColumn + 1) * COLUMN_WIDTH + GRAPH_PADDING * 2,
	);
	const columnX = useCallback(
		(column: number) =>
			GRAPH_PADDING +
			displayGraphColumn(column) * COLUMN_WIDTH +
			COLUMN_WIDTH / 2,
		[displayGraphColumn],
	);
	const connectionPath = useCallback(
		(transition: RowTransition) =>
			buildGraphConnectionPath({
				...transition,
				fromCol: displayGraphColumn(transition.fromCol),
				toCol: displayGraphColumn(transition.toCol),
			}),
		[displayGraphColumn],
	);
	const convergencePath = useCallback(
		(transition: RowTransition) =>
			buildGraphConvergencePath({
				...transition,
				fromCol: displayGraphColumn(transition.fromCol),
				toCol: displayGraphColumn(transition.toCol),
			}),
		[displayGraphColumn],
	);
	const visibleColumns = order.filter(
		(column) =>
			(column !== "date" || columns.date) &&
			(column !== "author" || columns.author) &&
			(column !== "sha" || columns.sha),
	);
	const renderedColumnWidth = (column: ColumnKey) =>
		column === "graph" ? graphWidth : widths[column];
	const graphLeft = visibleColumns
		.slice(0, visibleColumns.indexOf("graph"))
		.reduce((total, column) => total + renderedColumnWidth(column), 0);
	const tableWidth =
		visibleColumns.reduce(
			(total, column) => total + renderedColumnWidth(column),
			0,
		) + TOOLS_WIDTH;
	const normalizedQuery = query.trim();
	const matchingHashes = useMemo(() => {
		if (!normalizedQuery) return new Set(commits.map((commit) => commit.id));
		return new Set(
			commits
				.filter((commit) => matchesGraphSearch(commit, normalizedQuery))
				.map((commit) => commit.id),
		);
	}, [commits, normalizedQuery]);
	const totalHeight = commits.length * ROW_HEIGHT;
	const selectableItems = useMemo(
		() => commits.map((commit) => commit.id),
		[commits],
	);
	const { start: visibleStart, end: visibleEnd } = graphVirtualRange(
		commits.length,
		scrollTop,
		viewportHeight,
		ROW_HEIGHT,
		ROW_OVERSCAN,
	);

	useEffect(() => {
		if (
			!normalizedQuery ||
			matchingHashes.size > 0 ||
			!hasMore ||
			loadingMore ||
			!onLoadMore
		)
			return;
		const timer = window.setTimeout(onLoadMore, 250);
		return () => window.clearTimeout(timer);
	}, [hasMore, loadingMore, matchingHashes.size, normalizedQuery, onLoadMore]);

	useEffect(() => {
		const scroller = scrollerRef.current;
		if (!scroller) return;
		const update = () => setViewportHeight(scroller.clientHeight);
		update();
		const observer = new ResizeObserver(update);
		observer.observe(scroller);
		return () => observer.disconnect();
	}, []);

	const toggleColumn = (key: keyof ColumnVisibility) =>
		setColumns((cur) => ({ ...cur, [key]: !cur[key] }));
	const moveColumn = useCallback((source: ColumnKey, target: ColumnKey) => {
		setOrder((current) => moveGraphColumn(current, source, target));
	}, []);
	const rememberScroll = useCallback(
		(top: number, left: number) => {
			scrollPositionRef.current = { top, left };
			setScrollTop(top);
			if (scrollWriteTimerRef.current !== null) {
				window.clearTimeout(scrollWriteTimerRef.current);
			}
			scrollWriteTimerRef.current = window.setTimeout(() => {
				writeStoredJson(scrollPreferencesKey(repositoryKey), { top, left });
				scrollWriteTimerRef.current = null;
			}, 160);
		},
		[repositoryKey],
	);
	const openRefContextMenu = useCallback(
		(ref: GitGraphRef, event: MouseEvent) => {
			setItemContextMenu(null);
			setRefContextMenu({
				ref,
				x: Math.max(8, Math.min(event.clientX, window.innerWidth - 232)),
				y: Math.max(8, Math.min(event.clientY, window.innerHeight - 460)),
			});
		},
		[],
	);
	const openItemContextMenu = useCallback(
		(item: GraphNode, event: MouseEvent) => {
			setRefContextMenu(null);
			setItemContextMenu({
				item,
				x: Math.min(event.clientX, window.innerWidth - 224),
				y: Math.min(event.clientY, window.innerHeight - 260),
			});
		},
		[],
	);
	const navigateRows = useCallback(
		(event: KeyboardEvent) => {
			if (
				event.key !== "ArrowUp" &&
				event.key !== "ArrowDown" &&
				event.key !== "ArrowLeft" &&
				event.key !== "ArrowRight" &&
				event.key !== "Home" &&
				event.key !== "End"
			)
				return;
			if (!selectableItems.length) return;
			event.preventDefault();
			const currentIndex = selectedHash
				? selectableItems.indexOf(selectedHash)
				: -1;
			if (
				event.altKey &&
				(event.key === "ArrowUp" || event.key === "ArrowDown") &&
				selectedHash
			) {
				const branch = containingBranches.get(selectedHash);
				const next = branch
					? adjacentCommitOnBranch(
							commits,
							selectedHash,
							branch.target,
							event.key === "ArrowUp" ? "newer" : "older",
						)
					: undefined;
				if (next) {
					const nextIndex = selectableItems.indexOf(next);
					onSelect?.(next);
					scrollerRef.current?.scrollTo({
						top: Math.max(0, nextIndex * ROW_HEIGHT - ROW_HEIGHT * 2),
						behavior: "smooth",
					});
				}
				return;
			}
			if (
				(event.key === "ArrowLeft" || event.key === "ArrowRight") &&
				currentIndex >= 0
			) {
				const current = commits[currentIndex];
				const connected =
					event.key === "ArrowLeft"
						? current?.parents[0]
							? commits.find((commit) => commit.hash === current.parents[0])
							: undefined
						: commits.find((commit) =>
								commit.parents.includes(current?.hash ?? ""),
							);
				if (connected) {
					const connectedIndex = commits.indexOf(connected);
					onSelect?.(connected.id);
					scrollerRef.current?.scrollTo({
						top: Math.max(0, connectedIndex * ROW_HEIGHT - ROW_HEIGHT * 2),
						behavior: "smooth",
					});
				}
				return;
			}
			const nextIndex =
				event.key === "Home"
					? 0
					: event.key === "End"
						? selectableItems.length - 1
						: Math.max(
								0,
								Math.min(
									selectableItems.length - 1,
									(currentIndex < 0 ? 0 : currentIndex) +
										(event.key === "ArrowUp" ? -1 : 1),
								),
							);
			const next = selectableItems[nextIndex]!;
			onSelect?.(next);
			scrollerRef.current?.scrollTo({
				top: Math.max(0, nextIndex * ROW_HEIGHT - ROW_HEIGHT * 2),
				behavior: "smooth",
			});
		},
		[commits, containingBranches, onSelect, selectableItems, selectedHash],
	);
	const startColumnResize = useCallback(
		(column: keyof ColumnWidths, event: PointerEvent) => {
			if (event.button !== 0) return;
			event.preventDefault();
			const startX = event.clientX;
			const startWidth = widths[column];
			const releaseSelection = lockPointerSelection();
			const move = (moveEvent: PointerEvent) => {
				setWidths((current) => ({
					...current,
					[column]: Math.max(
						MIN_COLUMN_WIDTHS[column],
						Math.min(MAX_COLUMN_WIDTH, startWidth + moveEvent.clientX - startX),
					),
				}));
			};
			const stop = () => {
				releaseSelection();
				window.removeEventListener("pointermove", move);
				window.removeEventListener("pointerup", stop);
				window.removeEventListener("pointercancel", stop);
			};
			window.addEventListener("pointermove", move);
			window.addEventListener("pointerup", stop, { once: true });
			window.addEventListener("pointercancel", stop, { once: true });
		},
		[widths],
	);

	const railSegments = useMemo(() => {
		const segments: Array<{
			key: string;
			row: number;
			column: number;
			color: string;
			startsAtNode: boolean;
			endsAtNode: boolean;
		}> = [];
		for (const row of rows.slice(visibleStart, visibleEnd)) {
			const logicalRow = row.row;
			for (const rail of row.rails) {
				segments.push({
					key: `rail-${logicalRow}-${rail.column}`,
					row: logicalRow,
					column: rail.column,
					color: rail.color,
					startsAtNode: rail.startsAtNode === true,
					endsAtNode: rail.endsAtNode === true,
				});
			}
		}
		return segments;
	}, [rows, visibleEnd, visibleStart]);
	const convergences = useMemo(() => {
		const result: RowTransition[] = [];
		for (const row of rows.slice(visibleStart, visibleEnd)) {
			const logicalRow = row.row;
			for (const transition of row.convergences ?? []) {
				result.push({
					row: logicalRow,
					fromCol: transition.fromColumn,
					toCol: transition.toColumn,
					color: transition.color,
				});
			}
		}
		return result;
	}, [rows, visibleEnd, visibleStart]);

	const transitions = useMemo(() => {
		const result: RowTransition[] = [];
		for (const row of rows.slice(visibleStart, visibleEnd)) {
			const logicalRow = row.row;
			for (const transition of row.transitions) {
				result.push({
					row: logicalRow,
					fromCol: transition.fromColumn,
					toCol: transition.toColumn,
					color: transition.color,
				});
			}
		}
		return result;
	}, [rows, visibleEnd, visibleStart]);
	const truncatedSegments = useMemo(() => {
		const segments: Array<{
			key: string;
			row: number;
			column: number;
			color: string;
		}> = [];
		for (const row of rows.slice(visibleStart, visibleEnd)) {
			const logicalRow = row.row;
			for (const edge of row.truncatedEdges) {
				segments.push({
					key: `truncated-${logicalRow}-${edge.column}`,
					row: logicalRow,
					column: edge.column,
					color: edge.color,
				});
			}
		}
		return segments;
	}, [rows, visibleEnd, visibleStart]);

	if (!commits.length) {
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

	const rootProps = stylex.props(styles.root, embedded && styles.embeddedRoot);
	return (
		<div
			ref={scrollerRef}
			{...rootProps}
			className={`${rootProps.className ?? ""} ${className}`}
			role="listbox"
			aria-label="Repository commit history"
			aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
			onScroll={(event) => {
				rememberScroll(
					event.currentTarget.scrollTop,
					event.currentTarget.scrollLeft,
				);
				const remaining =
					event.currentTarget.scrollHeight -
					event.currentTarget.scrollTop -
					event.currentTarget.clientHeight;
				if (
					hasMore &&
					!loadingMore &&
					onLoadMore &&
					remaining < ROW_HEIGHT * 16
				) {
					onLoadMore();
				}
			}}
			onWheel={(event) => {
				if (
					event.target instanceof Element &&
					event.target.closest('[role="menu"]')
				)
					return;
				if (event.cancelable) event.preventDefault();
				const scroller = event.currentTarget;
				scroller.scrollTop += event.deltaY;
				scroller.scrollLeft += event.deltaX;
				rememberScroll(scroller.scrollTop, scroller.scrollLeft);
			}}
			onKeyDown={navigateRows}
		>
			<HeaderRow
				graphWidth={graphWidth}
				columns={columns}
				widths={widths}
				order={order}
				isColumnsOpen={isColumnsOpen}
				onToggleColumnsMenu={setIsColumnsOpen.bind(null, toggleBoolean)}
				onToggleColumn={toggleColumn}
				onMoveColumn={moveColumn}
				onResizeStart={startColumnResize}
				hiddenRefs={hiddenRefDetails}
				onShowRef={(fullName) =>
					setHiddenRefs((current) =>
						current.filter((value) => value !== fullName),
					)
				}
				query={query}
				onQueryChange={setQuery}
				matchCount={matchingHashes.size}
			/>

			{/* SVG lines layer — clipped to ref+graph area */}
			<CommitGraphLinesLayer
				className={stylex.props(styles.linesLayer).className}
				width={graphWidth}
				height={totalHeight}
				style={{
					zIndex: 0,
					left: graphLeft,
				}}
				railSegments={railSegments}
				transitions={transitions}
				convergences={convergences}
				truncatedSegments={truncatedSegments}
				colX={columnX}
				rowTop={rowTop}
				rowBottom={rowBottom}
				buildConnection={connectionPath}
				buildConvergence={convergencePath}
				lineWidth={LINE_WIDTH}
			/>

			{/* Rows layer — avatar nodes sit on top of lines */}
			<div
				{...stylex.props(styles.rowsLayer)}
				style={{ height: totalHeight, width: tableWidth }}
			>
				{commits.slice(visibleStart, visibleEnd).map((commit, visibleIndex) => {
					const logicalIndex = visibleStart + visibleIndex;
					return (
						<CommitRow
							key={commit.id}
							commit={commit}
							worktree={
								commit.worktreePath
									? worktreesByPath.get(commit.worktreePath)
									: undefined
							}
							graphWidth={graphWidth}
							displayColumn={displayGraphColumn(commit.column)}
							selected={
								selectedHash === commit.id || selectedIds.includes(commit.id)
							}
							onSelect={onSelect}
							onCheckoutRef={onCheckoutRef}
							onRefDrop={onRefDrop}
							onOpenRefContextMenu={openRefContextMenu}
							onOpenItemContextMenu={openItemContextMenu}
							ghostRef={containingBranches.get(commit.id)}
							hiddenRefNames={hiddenRefNames}
							pinnedRefNames={pinnedRefNames}
							historyMatch={
								activeHistoryTargets.length === 0 ||
								reachableHistory.has(commit.id) ||
								reachableHistory.has(commit.hash)
							}
							columns={columns}
							widths={widths}
							order={order}
							virtualTop={logicalIndex * ROW_HEIGHT}
							searchMatch={matchingHashes.has(commit.id)}
							githubAvatar={commitAvatars[commit.hash] ?? undefined}
						/>
					);
				})}
			</div>
			{hasMore ? (
				<button
					type="button"
					disabled={loadingMore}
					onClick={onLoadMore}
					{...stylex.props(styles.loadMore)}
				>
					{loadingMore ? "Loading older commits…" : "Load older commits"}
				</button>
			) : null}
			{refContextMenu ? (
				<div
					role="menu"
					aria-label={`Actions for ${refContextMenu.ref.displayName}`}
					{...stylex.props(styles.refContextMenu)}
					style={{ left: refContextMenu.x, top: refContextMenu.y }}
					onPointerDown={(event) => event.stopPropagation()}
				>
					<div {...stylex.props(styles.refContextTitle)}>
						{refContextMenu.ref.displayName}
					</div>
					{(refContextMenu.ref.kind === "head" ||
						refContextMenu.ref.kind === "localBranch") &&
					refContextMenu.ref.fullName.startsWith("refs/heads/") ? (
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								onCheckoutRef?.(refContextMenu.ref.displayName);
								setRefContextMenu(null);
							}}
							{...stylex.props(styles.refContextItem)}
						>
							Checkout {refContextMenu.ref.displayName}
						</button>
					) : null}
					{branch &&
					(refContextMenu.ref.kind === "head" ||
						refContextMenu.ref.kind === "localBranch") &&
					refContextMenu.ref.fullName.startsWith("refs/heads/") &&
					refContextMenu.ref.displayName !== branch ? (
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								onRefDrop?.(refContextMenu.ref.displayName, branch);
								setRefContextMenu(null);
							}}
							{...stylex.props(styles.refContextItem)}
						>
							Merge or rebase with {branch}…
						</button>
					) : null}
					{(refContextMenu.ref.kind === "head" ||
						refContextMenu.ref.kind === "localBranch") &&
					refContextMenu.ref.fullName.startsWith("refs/heads/") ? (
						<>
							<button
								type="button"
								role="menuitem"
								onClick={() => {
									onGraphAction?.({
										action: "renameBranch",
										target: refContextMenu.ref.displayName,
										itemId: refContextMenu.ref.target,
									});
									setRefContextMenu(null);
								}}
								{...stylex.props(styles.refContextItem)}
							>
								Rename branch…
							</button>
							{refContextMenu.ref.kind === "localBranch" ? (
								<button
									type="button"
									role="menuitem"
									onClick={() => {
										onGraphAction?.({
											action: "deleteBranch",
											target: refContextMenu.ref.displayName,
											itemId: refContextMenu.ref.target,
										});
										setRefContextMenu(null);
									}}
									{...stylex.props(styles.refContextItem)}
								>
									Delete branch…
								</button>
							) : null}
							<button
								type="button"
								role="menuitem"
								onClick={() => {
									onGraphAction?.({
										action: "setUpstream",
										target: refContextMenu.ref.displayName,
										itemId: refContextMenu.ref.target,
										suggestedName: refContextMenu.ref.upstream,
									});
									setRefContextMenu(null);
								}}
								{...stylex.props(styles.refContextItem)}
							>
								Set or change upstream…
							</button>
							{refContextMenu.ref.displayName === branch &&
							!refContextMenu.ref.upstream ? (
								<button
									type="button"
									role="menuitem"
									onClick={() => {
										onGraphAction?.({
											action: "pushSetUpstream",
											target: refContextMenu.ref.displayName,
											itemId: refContextMenu.ref.target,
											suggestedName: defaultRemoteName,
										});
										setRefContextMenu(null);
									}}
									{...stylex.props(styles.refContextItem)}
								>
									Push and set upstream…
								</button>
							) : null}
							{refContextMenu.ref.displayName === branch &&
							refContextMenu.ref.upstream ? (
								<button
									type="button"
									role="menuitem"
									onClick={() => {
										onGraphAction?.({
											action: "forcePushWithLease",
											target: refContextMenu.ref.displayName,
											itemId: refContextMenu.ref.target,
										});
										setRefContextMenu(null);
									}}
									{...stylex.props(styles.refContextItem)}
								>
									Force push with lease…
								</button>
							) : null}
						</>
					) : null}
					{refContextMenu.ref.kind === "remoteBranch" ? (
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								onGraphAction?.({
									action: "deleteRemoteBranch",
									target: refContextMenu.ref.fullName,
									itemId: refContextMenu.ref.target,
								});
								setRefContextMenu(null);
							}}
							{...stylex.props(styles.refContextItem)}
						>
							Delete remote branch…
						</button>
					) : null}
					{refContextMenu.ref.kind === "tag"
						? (["pushTag", "deleteRemoteTag", "deleteTag"] as const).map(
								(action) => (
									<button
										key={action}
										type="button"
										role="menuitem"
										onClick={() => {
											onGraphAction?.({
												action,
												target: refContextMenu.ref.displayName,
												itemId: refContextMenu.ref.target,
												suggestedName: defaultRemoteName,
											});
											setRefContextMenu(null);
										}}
										{...stylex.props(styles.refContextItem)}
									>
										{action === "pushTag"
											? "Push tag…"
											: action === "deleteRemoteTag"
												? "Delete remote tag…"
												: "Delete local tag…"}
									</button>
								),
							)
						: null}
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							const fullName = refContextMenu.ref.fullName;
							setSoloRefs((current) =>
								current.includes(fullName)
									? current.filter((value) => value !== fullName)
									: [...current, fullName],
							);
							setRefContextMenu(null);
						}}
						{...stylex.props(styles.refContextItem)}
					>
						{soloRefs.includes(refContextMenu.ref.fullName)
							? "Stop soloing ref"
							: "Solo ref"}
					</button>
					{refContextMenu.ref.kind !== "stash" ? (
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								const fullName = refContextMenu.ref.fullName;
								setPinnedRefs((current) =>
									current.includes(fullName)
										? current.filter((value) => value !== fullName)
										: [...current, fullName],
								);
								setRefContextMenu(null);
							}}
							{...stylex.props(styles.refContextItem)}
						>
							{pinnedRefs.includes(refContextMenu.ref.fullName)
								? "Unpin lane"
								: "Pin lane left"}
						</button>
					) : null}
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							const fullName = refContextMenu.ref.fullName;
							setHiddenRefs((current) =>
								current.includes(fullName) ? current : [...current, fullName],
							);
							setSoloRefs((current) =>
								current.filter((value) => value !== fullName),
							);
							setRefContextMenu(null);
						}}
						{...stylex.props(styles.refContextItem)}
					>
						Hide ref
					</button>
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							void navigator.clipboard.writeText(refContextMenu.ref.fullName);
							setRefContextMenu(null);
						}}
						{...stylex.props(styles.refContextItem)}
					>
						Copy ref name
					</button>
				</div>
			) : null}
			{itemContextMenu ? (
				<div
					role="menu"
					aria-label={`Actions for ${itemContextMenu.item.message}`}
					{...stylex.props(styles.refContextMenu)}
					style={{ left: itemContextMenu.x, top: itemContextMenu.y }}
					onPointerDown={(event) => event.stopPropagation()}
				>
					<div {...stylex.props(styles.refContextTitle)}>
						{itemContextMenu.item.itemKind === "worktreeWip"
							? "Uncommitted changes"
							: itemContextMenu.item.message}
					</div>
					{itemContextMenu.item.itemKind !== "worktreeWip" ? (
						<>
							{itemContextMenu.item.itemKind === "commit" &&
							onCompareWithWip ? (
								<button
									type="button"
									role="menuitem"
									onClick={() => {
										onCompareWithWip(itemContextMenu.item.id);
										setItemContextMenu(null);
									}}
									{...stylex.props(styles.refContextItem)}
								>
									Compare commit with WIP
								</button>
							) : null}
							<button
								type="button"
								role="menuitem"
								onClick={() => {
									void navigator.clipboard.writeText(itemContextMenu.item.hash);
									setItemContextMenu(null);
								}}
								{...stylex.props(styles.refContextItem)}
							>
								Copy full SHA
							</button>
							<button
								type="button"
								role="menuitem"
								onClick={() => {
									void navigator.clipboard.writeText(
										itemContextMenu.item.hash.slice(0, 7),
									);
									setItemContextMenu(null);
								}}
								{...stylex.props(styles.refContextItem)}
							>
								Copy abbreviated SHA
							</button>
						</>
					) : null}
					{(itemContextMenu.item.itemKind === "worktreeWip"
						? itemContextMenu.item.id === "wip"
							? (["stashPush"] as const)
							: ([] as const)
						: itemContextMenu.item.itemKind === "stash"
							? ([
									"stashApply",
									"stashPop",
									"stashRename",
									"stashDrop",
								] as const)
							: ([
									"createBranch",
									"createTag",
									"cherryPick",
									"revert",
									"resetSoft",
									"resetMixed",
									"resetHard",
								] as const)
					).map((action) => {
						const labels = {
							createBranch: "Create branch here…",
							createTag: "Create tag here…",
							cherryPick:
								selectedIds.length > 1 &&
								selectedIds.includes(itemContextMenu.item.id)
									? `Cherry-pick ${selectedIds.length} commits…`
									: "Cherry-pick commit…",
							revert: "Revert commit…",
							stashPush: "Stash changes…",
							stashApply: "Apply stash…",
							stashPop: "Pop stash…",
							stashRename: "Rename stash…",
							stashDrop: "Delete stash…",
							resetSoft: "Reset branch here (soft)…",
							resetMixed: "Reset branch here (mixed)…",
							resetHard: "Reset branch here (hard)…",
						} as const;
						return (
							<button
								key={action}
								type="button"
								role="menuitem"
								onClick={() => {
									const targets =
										action === "cherryPick" &&
										selectedIds.length > 1 &&
										selectedIds.includes(itemContextMenu.item.id)
											? commits
													.filter(
														(commit) =>
															commit.itemKind === "commit" &&
															selectedIds.includes(commit.id),
													)
													.reverse()
													.map((commit) => commit.hash)
											: undefined;
									onGraphAction?.({
										action,
										target:
											itemContextMenu.item.itemKind === "stash"
												? itemContextMenu.item.stashName
												: itemContextMenu.item.hash,
										itemId: itemContextMenu.item.id,
										targets,
									});
									setItemContextMenu(null);
								}}
								{...stylex.props(styles.refContextItem)}
							>
								{labels[action]}
							</button>
						);
					})}
				</div>
			) : null}
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
		borderRadius: radius.md,
		backgroundColor: color.background,
	},
	embeddedRoot: {
		height: "100%",
		borderWidth: controlSize._0,
		borderRadius: radius.none,
	},
	loadMore: {
		display: "flex",
		width: "100%",
		height: controlSize._8,
		alignItems: "center",
		justifyContent: "center",
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: color.border,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: color.textMuted,
		fontSize: font.size_2,
	},
	emptyRoot: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		backgroundColor: color.background,
		paddingBlock: controlSize._8,
	},
	emptyText: {
		color: color.textMuted,
		fontSize: font.size_2_75,
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
		position: "relative",
		zIndex: layer.content,
		display: "inline-flex",
		height: "17px",
		minWidth: controlSize._0,
		maxWidth: "100%",
		boxSizing: "border-box",
		flexShrink: 1,
		alignItems: "center",
		gap: controlSize._1,
		overflow: "hidden",
		borderRadius: "2px",
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		lineHeight: 1,
		paddingInline: "0.375rem",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	refAhead: {
		flexShrink: 0,
		color: palette.green,
		fontVariantNumeric: "tabular-nums",
	},
	ghostRefBadge: {
		opacity: 0.72,
		fontStyle: "italic",
	},
	refBehind: {
		flexShrink: 0,
		color: palette.red,
		fontVariantNumeric: "tabular-nums",
	},
	refBadges: {
		position: "relative",
		zIndex: layer.content,
		display: "flex",
		alignItems: "center",
		gap: controlSize._1,
		overflow: "visible",
		minWidth: controlSize._0,
	},
	refBadgesOpen: {
		zIndex: layer.dropdown,
	},
	refExtra: {
		flexShrink: 0,
		color: color.textSoft,
		fontSize: font.size_0_5,
		fontVariantNumeric: "tabular-nums",
	},
	refBadgeStack: {
		position: "absolute",
		left: controlSize._0,
		top: "calc(100% + 2px)",
		zIndex: layer.dropdown,
		display: "flex",
		maxWidth: "13.25rem",
		alignItems: "flex-start",
		flexDirection: "column",
		gap: controlSize._1,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		backgroundColor: color.backgroundRaised,
		boxShadow: shadow.popover,
		padding: controlSize._1,
	},
	header: {
		position: "sticky",
		top: controlSize._0,
		zIndex: layer.control,
		display: "flex",
		height: "22px",
		alignItems: "center",
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.background,
		backdropFilter: "blur(8px)",
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		letterSpacing: "0.16em",
		textTransform: "uppercase",
	},
	headerCell: {
		position: "relative",
		display: "flex",
		height: "100%",
		flexShrink: 0,
		alignItems: "center",
		overflow: "hidden",
		paddingInline: controlSize._3,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		boxSizing: "border-box",
	},
	draggableHeader: {
		cursor: "grab",
	},
	headerTools: {
		display: "flex",
		height: "100%",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
	},
	headerCellRight: {
		justifyContent: "flex-end",
	},
	headerCellBorder: {
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
	},
	columnResizeHandle: {
		position: "absolute",
		top: controlSize._0,
		right: "-3px",
		bottom: controlSize._0,
		zIndex: layer.overlayContent,
		width: "6px",
		borderWidth: controlSize._0,
		backgroundColor: {
			default: color.transparent,
			":hover": color.accentBorder,
		},
		cursor: "col-resize",
	},
	refContextMenu: {
		position: "fixed",
		zIndex: layer.dropdown,
		display: "flex",
		width: "13rem",
		maxHeight: "calc(100vh - 16px)",
		flexDirection: "column",
		overflowY: "auto",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.borderStrong,
		borderRadius: radius.md,
		backgroundColor: color.backgroundRaised,
		boxShadow: shadow.popover,
		padding: controlSize._1,
	},
	refContextTitle: {
		overflow: "hidden",
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._2,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	refContextItem: {
		width: "100%",
		borderRadius: radius.sm,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		fontSize: font.size_2,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._2,
		textAlign: "left",
	},
	descriptionHeader: {
		minWidth: controlSize._0,
		flex: 1,
		paddingInline: controlSize._3,
	},
	columnsMenuRoot: {
		position: "relative",
		display: "flex",
		width: "100%",
		height: "100%",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
	},
	columnsButton: {
		display: "flex",
		width: "100%",
		height: "100%",
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 0,
		borderRadius: radius.none,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
	},
	columnsMenu: {
		position: "absolute",
		right: controlSize._2,
		top: "22px",
		zIndex: layer.dropdown,
		width: "15rem",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		backgroundColor: color.backgroundRaised,
		boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.6)",
		padding: controlSize._1,
	},
	columnsMenuSection: {
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: color.border,
		color: color.textMuted,
		fontSize: font.size_0_5,
		letterSpacing: "0.1em",
		marginTop: controlSize._1,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._2,
		textTransform: "uppercase",
	},
	columnsMenuItem: {
		display: "flex",
		width: "100%",
		alignItems: "center",
		justifyContent: "space-between",
		borderRadius: radius.sm,
		color: color.textSoft,
		fontSize: font.size_2,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		textAlign: "left",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
	},
	columnsState: {
		color: color.textMuted,
	},
	searchRoot: {
		display: "flex",
		height: controlSize._6,
		alignItems: "center",
		gap: controlSize._1,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
		color: color.textMuted,
		marginBottom: controlSize._1,
		paddingInline: controlSize._2,
	},
	searchInput: {
		width: "100%",
		minWidth: controlSize._0,
		borderWidth: 0,
		outline: "none",
		backgroundColor: color.transparent,
		color: color.textSoft,
		fontSize: font.size_2,
	},
	searchCount: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontVariantNumeric: "tabular-nums",
	},
	linesLayer: {
		position: "absolute",
		left: controlSize._0,
		top: "22px",
		pointerEvents: "none",
	},
	rowsLayer: {
		position: "relative",
		zIndex: layer.chrome,
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
		padding: controlSize._0,
		textAlign: "left",
		":focus-visible": {
			boxShadow: `inset 0 0 0 1px ${color.borderStrong}`,
		},
	},
	virtualRow: {
		position: "absolute",
		left: controlSize._0,
		right: controlSize._0,
		top: controlSize._0,
	},
	refGutter: {
		position: "relative",
		display: "flex",
		height: "100%",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "flex-start",
		overflow: "visible",
		boxSizing: "border-box",
		paddingInline: controlSize._2,
	},
	refConnector: {
		minWidth: controlSize._1,
		flex: 1,
		height: "1px",
		opacity: 1,
		marginRight: "-0.5rem",
	},
	graphCell: {
		position: "relative",
		height: "100%",
		flexShrink: 0,
		overflow: "hidden",
	},
	nodeAnchoredRowWash: {
		position: "absolute",
		right: controlSize._0,
		pointerEvents: "none",
		borderRadius: "1px",
	},
	refToNodeConnector: {
		position: "absolute",
		left: controlSize._0,
		top: "50%",
		height: "1px",
		opacity: 1,
		transform: "translateY(-0.5px)",
		zIndex: layer.content,
	},
	wipNode: {
		position: "absolute",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		width: AVATAR_SIZE,
		height: AVATAR_SIZE,
		borderWidth: 1,
		borderStyle: "dashed",
		borderRadius: radius.pill,
		backgroundColor: "var(--color-inferay-black)",
		boxShadow: "0 0 2px rgba(249,115,22,0.16)",
		zIndex: layer.overlayContent,
	},
	messageCell: {
		display: "flex",
		boxSizing: "border-box",
		minWidth: controlSize._0,
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._2,
		overflow: "hidden",
		paddingInline: controlSize._3,
	},
	commitMessage: {
		maxWidth: "64%",
		flexShrink: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textSoft,
		fontSize: font.size_2_75,
		lineHeight: 1,
	},
	commitBody: {
		minWidth: controlSize._0,
		flex: 1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_2,
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
		borderColor: palette.orange70,
		borderRadius: radius.pill,
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
		fontVariantNumeric: "tabular-nums",
		overflow: "hidden",
		boxSizing: "border-box",
		paddingInline: controlSize._2,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	shaCell: {
		display: "flex",
		height: "100%",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "flex-start",
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
		color: color.textMuted,
		fontFamily:
			"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
		fontSize: font.size_2,
		overflow: "hidden",
		paddingInline: controlSize._3,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	rowEndPad: {
		flexShrink: 0,
		width: 38,
	},
	graphAvatar: {
		position: "absolute",
		width: AVATAR_SIZE,
		height: AVATAR_SIZE,
		borderRadius: radius.pill,
		backgroundColor: "var(--color-inferay-black)",
		zIndex: layer.overlayContent,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		fontSize: "5px",
		fontWeight: font.weight_6,
		overflow: "hidden",
	},
	mergeNode: {
		position: "absolute",
		width: "10px",
		height: "10px",
		borderRadius: radius.pill,
		zIndex: layer.overlayContent,
	},
	stashNode: {
		borderRadius: radius.sm,
		backgroundColor: color.backgroundRaised,
	},
	avatarImage: {
		display: "block",
		width: "100%",
		height: "100%",
		borderRadius: radius.pill,
		objectFit: "cover",
	},
	authorAvatar: {
		width: controlSize._4,
		height: controlSize._4,
		flexShrink: 0,
		borderRadius: radius.pill,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		fontSize: "7px",
		fontWeight: font.weight_6,
	},
	authorName: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_2,
	},
});
