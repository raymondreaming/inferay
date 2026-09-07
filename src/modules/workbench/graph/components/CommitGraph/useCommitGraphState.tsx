import { useCallback, useEffect, useMemo, useRef, useState } from "octane";
import type { GitGraphRef } from "../../../../../../build/presentation/contracts/GitGraphRef.ts";
import {
	readStoredJson,
	writeStoredJson,
} from "../../../../../adapters/storage/stored-values.ts";
import { trackPointerResize } from "../../../../../shared/lib/data.ts";
import type { GraphNode } from "../../../../repository/model/git-graph.ts";
import { resolveGitCommitAvatars } from "../../../../repository/model/types.ts";
import type {
	CommitGraphProps,
	GraphPreferences,
} from "../../model/graph-model.ts";
import {
	buildCommitGraphViewModel,
	type ColumnKey,
	type ColumnVisibility,
	type ColumnWidths,
	EMPTY_SELECTED_IDS,
	MAX_COLUMN_WIDTH,
	MIN_COLUMN_WIDTHS,
	moveGraphColumn,
	preferencesKey,
	projectCommitGraphViewport,
	ROW_HEIGHT,
	scrollPreferencesKey,
	TOP_PADDING,
} from "../../model/graph-model.ts";
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
