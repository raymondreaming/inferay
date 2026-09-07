import { useCallback, useEffect, useMemo, useRef, useState } from "octane";
import type { GitGraphRef } from "../../../../../../build/presentation/contracts/GitGraphRef.ts";
import type { GitWorktree } from "../../../../../../build/presentation/contracts/GitWorktree.ts";
import { postJson } from "../../../../../adapters/backend/http.ts";
import { project as rustProject } from "../../../../../adapters/presentation/model.ts";
import {
	readStoredJson,
	writeStoredJson,
} from "../../../../../adapters/storage/stored-values.ts";
import { trackPointerResize } from "../../../../../shared/lib/data.ts";
import type {
	GraphNode,
	GraphPresentation,
	RenderGraphRow,
} from "../../../../repository/hooks/useGitGraph.tsx";

import { getGraphLineLayerStyle } from "./styles.ts";
export function useCommitGraphState(props: CommitGraphProps) {
	const {
		onSearchChange,
		emptyLabel = "No matching commits",
		searchActive = false,
		searchQuery = "",
		commits,
		rows,
		presentation,
		selectedHash,
		selectedIds = EMPTY_SELECTED_IDS,
		onSelect,
		className = "",
		worktrees = [],
		embedded = false,
		hasMore = false,
		loadingMore = false,
		repositoryKey,
		onOpenSelection,
	} = props;
	const preferences = props.preferences;
	const setPreferences = props.onPreferencesChange;
	const { columns, widths, order, soloRefs, pinnedRefs } = preferences;
	const setters = useMemo(() => {
		const field =
			<K extends keyof GraphPreferences>(key: K) =>
			(
				update:
					| GraphPreferences[K]
					| ((value: GraphPreferences[K]) => GraphPreferences[K]),
			) =>
				setPreferences((current) => ({
					...current,
					[key]: typeof update === "function" ? update(current[key]) : update,
				}));
		return {
			setColumns: field("columns"),
			setWidths: field("widths"),
			setOrder: field("order"),
			setHiddenRefs: field("hiddenRefs"),
			setSoloRefs: field("soloRefs"),
			setPinnedRefs: field("pinnedRefs"),
		};
	}, []);
	const {
		setColumns,
		setWidths,
		setOrder,
		setHiddenRefs,
		setSoloRefs,
		setPinnedRefs,
	} = setters;
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
	const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
	const [hoveredRow, setHoveredRow] = useState<string | null>(null);
	const keyboardNavigationRef = useRef(false);
	const mousePositionRef = useRef<{
		x: number;
		y: number;
	} | null>(null);
	const handleRowHover = useCallback((itemId: string | null) => {
		if (!keyboardNavigationRef.current) setHoveredRow(itemId);
	}, []);
	const scrollerRef = useRef<HTMLDivElement | null>(null);
	const scrollFrameRef = useRef<number | null>(null);
	const scrollWriteTimerRef = useRef<number | null>(null);
	const scrollPositionRef = useRef({
		top: 0,
		left: 0,
	});
	const restoredScrollKeyRef = useRef<string | null>(null);
	const [scrollTop, setScrollTop] = useState(0);
	const [viewportHeight, setViewportHeight] = useState(600);
	const [query, setQuery] = useState(searchQuery);
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
	const hasCommits = commits.length > 0;
	useEffect(() => {
		if (!embedded || !hasCommits) return;
		scrollerRef.current?.focus({
			preventScroll: true,
		});
	}, [embedded, hasCommits, repositoryKey]);
	useEffect(() => {
		const key = scrollPreferencesKey(repositoryKey);
		if (restoredScrollKeyRef.current === key || commits.length === 0) return;
		const position = readStoredJson<{
			top?: number;
			left?: number;
		}>(key, {});
		const scroller = scrollerRef.current;
		if (!scroller) return;
		restoredScrollKeyRef.current = key;
		const top = typeof position.top === "number" ? position.top : 0;
		const left = typeof position.left === "number" ? position.left : 0;
		scrollPositionRef.current = {
			top,
			left,
		};
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
		writeStoredJson(preferencesKey(repositoryKey), preferences);
	}, [preferences, repositoryKey]);
	const graphModel = useMemo(
		() =>
			buildCommitGraphViewModel({
				columns,
				commits,
				order,
				presentation,
				widths,
				worktrees,
			}),
		[columns, commits, order, presentation, widths, worktrees],
	);
	const viewportModel = useMemo(
		() =>
			projectCommitGraphViewport(
				rows,
				commits.length,
				scrollTop,
				viewportHeight,
			),
		[commits.length, rows, scrollTop, viewportHeight],
	);
	const { graphLeft, itemIndexes, selectableItems } = graphModel;
	const lineLayerStyle = useMemo(
		() => getGraphLineLayerStyle(graphLeft, TOP_PADDING),
		[graphLeft],
	);
	const normalizedQuery = query.trim();
	useEffect(() => {
		const timer = window.setTimeout(
			() => onSearchChange?.(normalizedQuery),
			200,
		);
		return () => window.clearTimeout(timer);
	}, [normalizedQuery, onSearchChange]);
	useEffect(() => {
		setQuery(searchQuery);
	}, [repositoryKey]);
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
		setColumns((cur) => ({
			...cur,
			[key]: !cur[key],
		}));
	const moveColumn = useCallback((source: ColumnKey, target: ColumnKey) => {
		setOrder((current) => moveGraphColumn(current, source, target));
	}, []);
	const rememberScroll = useCallback(
		(top: number, left: number) => {
			scrollPositionRef.current = {
				top,
				left,
			};
			if (scrollFrameRef.current === null) {
				scrollFrameRef.current = requestAnimationFrame(() => {
					scrollFrameRef.current = null;
					const nextTop = scrollPositionRef.current.top;
					setScrollTop((current) =>
						Math.floor(current / ROW_HEIGHT) ===
						Math.floor(nextTop / ROW_HEIGHT)
							? current
							: nextTop,
					);
				});
			}
			if (scrollWriteTimerRef.current !== null) {
				window.clearTimeout(scrollWriteTimerRef.current);
			}
			scrollWriteTimerRef.current = window.setTimeout(() => {
				writeStoredJson(scrollPreferencesKey(repositoryKey), {
					top,
					left,
				});
				scrollWriteTimerRef.current = null;
			}, 160);
		},
		[repositoryKey],
	);
	useEffect(
		() => () => {
			if (scrollFrameRef.current !== null)
				cancelAnimationFrame(scrollFrameRef.current);
		},
		[],
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
			keyboardNavigationRef.current = true;
			setHoveredRow(null);
			event.preventDefault();
			const currentIndex = selectedHash
				? (itemIndexes.get(selectedHash) ?? -1)
				: -1;
			if (
				event.altKey &&
				(event.key === "ArrowUp" || event.key === "ArrowDown") &&
				selectedHash
			) {
				const current = commits[currentIndex];
				const next =
					event.key === "ArrowUp"
						? current?.navigation?.branchNewer
						: current?.navigation?.branchOlder;
				if (next) {
					const nextIndex = itemIndexes.get(next) ?? -1;
					onSelect?.(next);
					scrollerRef.current?.scrollTo({
						top: Math.max(0, nextIndex * ROW_HEIGHT - ROW_HEIGHT * 2),
						behavior: "smooth",
					});
				}
				return;
			}
			if (event.key === "ArrowRight" && currentIndex >= 0 && onOpenSelection) {
				onOpenSelection(selectableItems[currentIndex]!);
				return;
			}
			if (
				(event.key === "ArrowLeft" || event.key === "ArrowRight") &&
				currentIndex >= 0
			) {
				const current = commits[currentIndex];
				const connectedId =
					event.key === "ArrowLeft"
						? current?.navigation?.parent
						: current?.navigation?.child;
				const connected = connectedId
					? commits[itemIndexes.get(connectedId) ?? -1]
					: undefined;
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
			if (event.key === "ArrowLeft" || event.key === "ArrowRight") return;
			const nextIndex =
				event.key === "Home"
					? 0
					: event.key === "End"
						? selectableItems.length - 1
						: currentIndex < 0
							? event.key === "ArrowUp"
								? selectableItems.length - 1
								: 0
							: Math.max(
									0,
									Math.min(
										selectableItems.length - 1,
										currentIndex + (event.key === "ArrowUp" ? -1 : 1),
									),
								);
			const next = selectableItems[nextIndex]!;
			onSelect?.(next);
			scrollerRef.current?.scrollTo({
				top: Math.max(0, nextIndex * ROW_HEIGHT - ROW_HEIGHT * 2),
				behavior: "smooth",
			});
		},
		[
			commits,
			onOpenSelection,
			onSelect,
			selectableItems,
			itemIndexes,
			selectedHash,
		],
	);
	const startColumnResize = useCallback(
		(column: keyof ColumnWidths, event: PointerEvent) => {
			if (event.button !== 0) return;
			event.preventDefault();
			const startX = event.clientX;
			const startWidth = widths[column];
			const move = (moveEvent: PointerEvent) => {
				setWidths((current) => ({
					...current,
					[column]: Math.max(
						MIN_COLUMN_WIDTHS[column],
						Math.min(MAX_COLUMN_WIDTH, startWidth + moveEvent.clientX - startX),
					),
				}));
			};
			trackPointerResize(event.pointerId, move);
		},
		[widths],
	);
	return {
		...props,
		...graphModel,
		...viewportModel,
		emptyLabel,
		searchActive,
		selectedIds,
		className,
		embedded,
		hasMore,
		loadingMore,
		columns,
		widths,
		order,
		setHiddenRefs,
		soloRefs,
		setSoloRefs,
		pinnedRefs,
		setPinnedRefs,
		isColumnsOpen,
		setIsColumnsOpen,
		commitAvatars,
		selectedIdSet,
		hoveredRow,
		setHoveredRow,
		keyboardNavigationRef,
		mousePositionRef,
		handleRowHover,
		scrollerRef,
		query,
		setQuery,
		refContextMenu,
		setRefContextMenu,
		itemContextMenu,
		setItemContextMenu,
		lineLayerStyle,
		toggleColumn,
		moveColumn,
		rememberScroll,
		openRefContextMenu,
		openItemContextMenu,
		navigateRows,
		startColumnResize,
	};
}

export async function resolveGitCommitAvatars(
	cwd: string,
	hashes: readonly string[],
): Promise<Record<string, string | null>> {
	if (!cwd || hashes.length === 0) return {};
	try {
		const response = await postJson<{
			avatars?: Record<string, string | null>;
		}>("/api/forge/commit-avatars", {
			cwd,
			hashes: [...new Set(hashes)],
		});
		return response.avatars ?? {};
	} catch {
		return {};
	}
}

export interface GraphSelectionIntent {
	additive: boolean;
	range: boolean;
}
export interface ColumnVisibility {
	author: boolean;
	sha: boolean;
	date: boolean;
}
export type ColumnKey =
	| "date"
	| "refs"
	| "graph"
	| "message"
	| "author"
	| "sha";
export interface ColumnWidths {
	date: number;
	refs: number;
	graph: number;
	message: number;
	author: number;
	sha: number;
}
export const TOOLS_WIDTH = 32;
const GIT_GRAPH_GEOMETRY = {
	rowHeight: 23,
	columnWidth: 18,
	avatarSize: 18,
	graphPadding: 18,
	graphWidth: 360,
	lineWidth: 2,
	curveRadius: 9,
} as const;
export const {
	rowHeight: ROW_HEIGHT,
	columnWidth: COLUMN_WIDTH,
	graphPadding: GRAPH_PADDING,
} = GIT_GRAPH_GEOMETRY;
export function hexToRgba(hex: string, alpha: number) {
	const c = hex.replace("#", "");
	const n = c.length === 3 ? c.replace(/[\s\S]/g, "$&$&") : c;
	return `rgba(${Number.parseInt(n.slice(0, 2), 16)}, ${Number.parseInt(n.slice(2, 4), 16)}, ${Number.parseInt(n.slice(4, 6), 16)}, ${alpha})`;
}
export interface CommitGraphProps {
	searchQuery?: string;
	searchActive?: boolean;
	emptyLabel?: string;
	onSearchChange?: (query: string) => void;
	commits: GraphNode[];
	rows: RenderGraphRow[];
	presentation: GraphPresentation;
	preferences: GraphPreferences;
	onPreferencesChange: (
		update:
			| GraphPreferences
			| ((current: GraphPreferences) => GraphPreferences),
	) => void;
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
	onOpenSelection?: (itemId: string) => void;
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
export interface GraphPreferences {
	columns: ColumnVisibility;
	widths: ColumnWidths;
	order: ColumnKey[];
	hiddenRefs: string[];
	soloRefs: string[];
	pinnedRefs: string[];
}
export const TOP_PADDING = ROW_HEIGHT;
const ROW_OVERSCAN = 12;
export const EMPTY_SELECTED_IDS: readonly string[] = [];
export const MIN_COLUMN_WIDTHS: ColumnWidths = {
	date: 84,
	refs: 96,
	graph: 48,
	message: 160,
	author: 88,
	sha: 56,
};
export const MAX_COLUMN_WIDTH = 480;
export function preferencesKey(repositoryKey?: string) {
	return `commit-graph-columns-v12:${repositoryKey ?? "default"}`;
}
export function scrollPreferencesKey(repositoryKey?: string) {
	return `commit-graph-scroll-v1:${repositoryKey ?? "default"}`;
}
export function loadPreferences(repositoryKey?: string): GraphPreferences {
	return rustProject(
		"graphPreferences",
		readStoredJson(preferencesKey(repositoryKey), {}),
	);
}
export interface RowTransition {
	row: number;
	fromCol: number;
	toCol: number;
	color: string;
}
export const DEFAULT_GIT_GRAPH_HISTORY_LIMIT = 1_000;
export function nextGitGraphHistoryLimit(current: number): number {
	return rustProject("nextHistoryLimit", current);
}
function graphVirtualRange(
	itemCount: number,
	scrollTop: number,
	viewportHeight: number,
) {
	const count = Math.max(0, Math.floor(itemCount));
	const viewport = Math.max(0, viewportHeight);
	const scroll = Math.max(0, scrollTop);
	return {
		start: Math.max(0, Math.floor(scroll / ROW_HEIGHT) - ROW_OVERSCAN),
		end: Math.min(
			count,
			Math.ceil((scroll + viewport) / ROW_HEIGHT) + ROW_OVERSCAN,
		),
	};
}
export function moveGraphColumn(
	order: readonly ColumnKey[],
	source: ColumnKey,
	target: ColumnKey,
): ColumnKey[] {
	return rustProject("moveColumn", { order, source, target });
}
function buildGraphConnectionPath(connection: RowTransition): string {
	return rustProject("graphPath", connection);
}
function buildGraphConvergencePath(connection: RowTransition): string {
	return rustProject("graphPath", { ...connection, convergence: true });
}
export function buildCommitGraphViewModel({
	commits,
	presentation,
	order,
	widths,
	columns,
	worktrees,
}: Pick<CommitGraphProps, "commits" | "presentation" | "worktrees"> &
	Pick<GraphPreferences, "columns" | "order" | "widths">) {
	const geometry = rustProject<{
		displayColumns: number[];
		graphWidth: number;
		graphLeft: number;
		graphHeight: number;
		tableWidth: number;
		totalHeight: number;
	}>("graphLayout", {
		commitColumns: commits.map((commit) => commit.column),
		pinnedColumns: presentation.pinnedColumns,
		order,
		widths,
		columns,
	});
	const displayGraphColumn = (column: number) =>
		geometry.displayColumns[column] ?? column;
	const columnX = (column: number) =>
		GRAPH_PADDING +
		displayGraphColumn(column) * COLUMN_WIDTH +
		COLUMN_WIDTH / 2;
	const remap = (transition: RowTransition) => ({
		...transition,
		fromCol: displayGraphColumn(transition.fromCol),
		toCol: displayGraphColumn(transition.toCol),
	});
	const connectionPath = (transition: RowTransition) =>
		buildGraphConnectionPath(remap(transition));
	const convergencePath = (transition: RowTransition) =>
		buildGraphConvergencePath(remap(transition));
	const selectableItems = presentation.selectableItems;
	return {
		columnX,
		connectionPath,
		containingBranches: new Map(
			Object.entries(presentation.containingBranches),
		),
		convergencePath,
		defaultRemoteName: presentation.defaultRemoteName,
		displayGraphColumn,
		...geometry,
		hiddenRefDetails: presentation.hiddenRefDetails,
		hiddenRefNames: new Set(presentation.hiddenRefNames),
		itemIndexes: new Map(selectableItems.map((id, index) => [id, index])),
		matchingHashes: new Set(selectableItems),
		pinnedRefNames: new Set(presentation.pinnedRefNames),
		reachableHistory: new Set(presentation.reachableHistory),
		selectableItems,
		worktreesByPath: new Map(worktrees?.map((tree) => [tree.path, tree]) ?? []),
	};
}
export function projectCommitGraphViewport(
	rows: readonly RenderGraphRow[],
	itemCount: number,
	scrollTop: number,
	viewportHeight: number,
) {
	const { start: visibleStart, end: visibleEnd } = graphVirtualRange(
		itemCount,
		Math.max(0, scrollTop - TOP_PADDING),
		viewportHeight,
	);
	const visibleRows = rows.slice(visibleStart, visibleEnd);
	const connections = (key: "convergences" | "transitions") =>
		visibleRows.flatMap((row) =>
			row[key].map((transition) => ({
				row: row.row,
				fromCol: transition.fromColumn,
				toCol: transition.toColumn,
				color: transition.color,
			})),
		);
	const segments = (key: "rails" | "truncatedEdges", prefix: string) =>
		visibleRows.flatMap((row) =>
			row[key].map((segment) => ({
				...segment,
				key: `${prefix}-${row.row}-${segment.column}`,
				row: row.row,
			})),
		);
	return {
		convergences: connections("convergences"),
		railSegments: segments("rails", "rail"),
		transitions: connections("transitions"),
		truncatedSegments: segments("truncatedEdges", "truncated"),
		visibleEnd,
		visibleStart,
	};
}
