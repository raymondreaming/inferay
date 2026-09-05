import { useCallback, useEffect, useMemo, useRef, useState } from "octane";
import {
	readStoredJson,
	writeStoredJson,
} from "../../../../../adapters/storage/stored-values.ts";
import { lockPointerSelection } from "../../../../../shared/lib/pointer-selection-lock.ts";
import type {
	GitGraphRef,
	GraphNode,
} from "../../../../repository/hooks/useGitGraph";
import { resolveGitCommitAvatars } from "../../../../repository/model/git-avatar.ts";
import {
	buildGraphConnectionPath,
	buildGraphConvergencePath,
	graphVirtualRange,
	moveGraphColumn,
	pinnedGraphColumnOrder,
} from "../../model/graph-model.ts";
import type { CommitGraphProps, RowTransition } from "./graph-preferences.ts";
import {
	EMPTY_SELECTED_IDS,
	loadPreferences,
	MAX_COLUMN_WIDTH,
	MIN_COLUMN_WIDTHS,
	preferencesKey,
	ROW_OVERSCAN,
	scrollPreferencesKey,
	TOP_PADDING,
} from "./graph-preferences.ts";
import {
	COLUMN_WIDTH,
	type ColumnKey,
	type ColumnVisibility,
	type ColumnWidths,
	GRAPH_PADDING,
	ROW_HEIGHT,
	TOOLS_WIDTH,
} from "./shared.ts";
import { getGraphLineLayerStyle } from "./styles.ts";

export function useCommitGraphState({
	ancestry,
	onSearchChange,
	emptyLabel = "No matching commits",
	searchActive = false,
	searchQuery = "",
	commits,
	rows,
	selectedHash,
	selectedIds = EMPTY_SELECTED_IDS,
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
	onOpenSelection,
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
	const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
	const [hoveredRow, setHoveredRow] = useState<string | null>(null);
	const keyboardNavigationRef = useRef(false);
	const mousePositionRef = useRef<{ x: number; y: number } | null>(null);
	const handleRowHover = useCallback((itemId: string | null) => {
		if (!keyboardNavigationRef.current) setHoveredRow(itemId);
	}, []);
	const scrollerRef = useRef<HTMLDivElement | null>(null);
	const scrollFrameRef = useRef<number | null>(null);
	const scrollWriteTimerRef = useRef<number | null>(null);
	const scrollPositionRef = useRef({ top: 0, left: 0 });
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
		scrollerRef.current?.focus({ preventScroll: true });
	}, [embedded, hasCommits, repositoryKey]);
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
		() =>
			new Map(
				commits.flatMap((commit) => {
					const ref = repositoryRefs.get(
						commit.navigation?.containingBranch ?? "",
					);
					return ref ? [[commit.id, ref] as const] : [];
				}),
			),
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
	const reachableHistory = useMemo(() => {
		const reachable = new Set<string>();
		for (const ref of soloRefs) {
			for (const [start, end] of ancestry?.[ref] ?? []) {
				for (let row = start; row <= end && row < commits.length; row++)
					reachable.add(commits[row]!.id);
			}
		}
		return reachable;
	}, [ancestry, commits, soloRefs]);

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
	const lineLayerStyle = useMemo(
		() => getGraphLineLayerStyle(graphLeft, TOP_PADDING),
		[graphLeft],
	);
	const tableWidth =
		visibleColumns.reduce(
			(total, column) => total + renderedColumnWidth(column),
			0,
		) + TOOLS_WIDTH;
	const normalizedQuery = query.trim();
	const matchingHashes = useMemo(
		() => new Set(commits.map((commit) => commit.id)),
		[commits],
	);
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

	const graphHeight = commits.length * ROW_HEIGHT;
	const totalHeight = TOP_PADDING + graphHeight;
	const selectableItems = useMemo(
		() => commits.map((commit) => commit.id),
		[commits],
	);
	const itemIndexes = useMemo(
		() => new Map(selectableItems.map((id, index) => [id, index])),
		[selectableItems],
	);
	const { start: visibleStart, end: visibleEnd } = graphVirtualRange(
		commits.length,
		Math.max(0, scrollTop - TOP_PADDING),
		viewportHeight,
		ROW_HEIGHT,
		ROW_OVERSCAN,
	);

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
				writeStoredJson(scrollPreferencesKey(repositoryKey), { top, left });
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
			containingBranches,
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

	return {
		commits,
		selectedHash,
		onSelect,
		branch,
		onCheckoutRef,
		onRefDrop,
		onLoadMore,
		onGraphAction,
		onCompareWithWip,
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
		worktreesByPath,
		containingBranches,
		hiddenRefDetails,
		defaultRemoteName,
		hiddenRefNames,
		pinnedRefNames,
		reachableHistory,
		displayGraphColumn,
		graphWidth,
		columnX,
		connectionPath,
		convergencePath,
		lineLayerStyle,
		tableWidth,
		matchingHashes,
		graphHeight,
		totalHeight,
		visibleStart,
		visibleEnd,
		toggleColumn,
		moveColumn,
		rememberScroll,
		openRefContextMenu,
		openItemContextMenu,
		navigateRows,
		startColumnResize,
		railSegments,
		convergences,
		transitions,
		truncatedSegments,
	};
}
export type {
	CommitGraphProps,
	GitGraphActionRequest,
	GraphPreferences,
	RowTransition,
} from "./graph-preferences.ts";
export {
	AUTHOR_WIDTH,
	COLUMN_PREFS_KEY,
	DATE_WIDTH,
	DEFAULT_COLUMN_ORDER,
	DEFAULT_COLUMNS,
	DEFAULT_WIDTHS,
	EMPTY_SELECTED_IDS,
	GRAPH_WIDTH,
	loadPreferences,
	MAX_COLUMN_WIDTH,
	MESSAGE_WIDTH,
	MIN_COLUMN_WIDTHS,
	normalizedColumnWidths,
	preferencesKey,
	REF_WIDTH,
	ROW_OVERSCAN,
	SCROLL_PREFS_KEY,
	SHA_WIDTH,
	scrollPreferencesKey,
	TOP_PADDING,
} from "./graph-preferences.ts";
