import type {
	GitGraphRef,
	GitWorktree,
	GraphCommit,
	GraphLines,
	GraphPresentation,
	GraphRow,
	GraphViewport,
	GitGraphActionRequest as NativeGitGraphActionRequest,
} from "@contracts";
import { runtimeGitGraphLaneColors } from "@design-system/styles.stylex.ts";
import { useGitAuthorAvatars } from "@repository/hooks/useGitAuthorAvatars.ts";
import {
	createPointerResize,
	px,
	repositoryKeyboardInput,
} from "@shared/lib/dom.tsx";
import {
	readStoredJson,
	project as rustProject,
	writeStoredJson,
} from "@shared/lib/native.tsx";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	merge,
	type Setter,
} from "solid-js";
import { useGraphViewport } from "./useGraphViewport.tsx";

export function useCommitGraphState(_props: Accessor<CommitGraphProps>) {
	const trackResize = createPointerResize();
	const preferences = createMemo(() => _props().preferences);
	const setPreference = <K extends keyof GraphPreferences>(
		key: K,
		update:
			| GraphPreferences[K]
			| ((value: GraphPreferences[K]) => GraphPreferences[K]),
	) =>
		_props().onPreferencesChange((current) => ({
			...current,
			[key]: typeof update === "function" ? update(current[key]) : update,
		}));
	const [isColumnsOpen, setIsColumnsOpen] = createSignal(false);
	const selectedIdSet = createMemo(() => new Set(_props().selectedIds));
	const [hoveredRow, setHoveredRow] = createSignal<string | null>(null);
	let keyboardNavigation = false;
	let mousePosition: { x: number; y: number } | null = null;
	let pointerMoved = false;
	const handleRowHover = (itemId: string | null) => {
		if (pointerMoved && !keyboardNavigation) setHoveredRow(itemId);
	};
	const handleMouseMove = (event: MouseEvent) => {
		const previous = mousePosition;
		mousePosition = { x: event.clientX, y: event.clientY };
		if (
			!previous ||
			(previous.x === event.clientX && previous.y === event.clientY)
		)
			return;
		pointerMoved = true;
		keyboardNavigation = false;
		const row =
			event.target instanceof Element
				? event.target.closest("[data-graph-item]")
				: null;
		setHoveredRow(row?.getAttribute("data-graph-item") ?? null);
	};
	const {
		headerRef,
		scrollerRef,
		scrollTop,
		viewportHeight,
		viewportWidth,
		rememberScroll,
	} = useGraphViewport(
		() => _props().repositoryKey,
		() => _props().commits.length > 0,
		ROW_HEIGHT,
	);
	const [query, setQuery] = createSignal(() => {
		void _props().repositoryKey;
		return _props().searchQuery ?? "";
	});
	const [refContextMenu, setRefContextMenu] = createSignal<{
		ref: GitGraphRef;
		x: number;
		y: number;
	} | null>(null);
	const [itemContextMenu, setItemContextMenu] = createSignal<{
		item: GraphCommit;
		x: number;
		y: number;
	} | null>(null);
	const hasCommits = createMemo(() => _props().commits.length > 0);
	createEffect(
		() => [hasCommits(), _props().repositoryKey, scrollerRef.current] as const,
		([ready, , scroller]) => {
			if (ready) scroller?.focus({ preventScroll: true });
		},
	);
	// History lookups do not depend on the window or column widths.
	const history = createMemo(() => {
		const presentation = _props().presentation;
		return {
			...presentation,
			hiddenRefNames: new Set(presentation.hiddenRefNames),
			pinnedRefNames: new Set(presentation.pinnedRefNames),
			reachableHistory: new Set(presentation.reachableHistory),
		};
	});
	const worktreesByPath = createMemo(
		() => new Map(_props().worktrees?.map((tree) => [tree.path, tree]) ?? []),
	);
	const [resizing, setResizing] = createSignal<{
		column: ColumnKey;
		width: number;
		compact: boolean;
	} | null>(null);
	const graphModel = createMemo(() =>
		rustProject<{
			compact: boolean;
			columnWidths: ColumnWidths;
			displayColumns: number[];
			visibleOrder: ColumnKey[];
			graphWidth: number;
			graphLeft: number;
			graphHeight: number;
			tableWidth: number;
		}>("graphLayout", {
			columns: preferences().columns,
			widths: {
				...preferences().widths,
				...(resizing() && !resizing()!.compact
					? { [resizing()!.column]: resizing()!.width }
					: {}),
			},
			compactWidths: {
				...preferences().compactWidths,
				...(resizing()?.compact
					? { [resizing()!.column]: resizing()!.width }
					: {}),
			},
			order: preferences().order,
			availableWidth: viewportWidth(),
			count: _props().commits.length,
			maxColumn: _props().presentation.maxColumn,
			pinnedColumns: _props().presentation.pinnedColumns,
			stretch: true,
		}),
	);
	const viewportModel = createMemo(() => {
		const viewport = rustProject<GraphViewport>("graphViewport", {
			count: _props().commits.length,
			scrollTop: scrollTop(),
			height: viewportHeight(),
		});
		return {
			...viewport,
			lines: rustProject<GraphLines>("graphLines", {
				rows: _props().rows.slice(viewport.visibleStart, viewport.visibleEnd),
				colors: runtimeGitGraphLaneColors,
				displayColumns: graphModel().displayColumns,
			}),
		};
	});
	const avatarForCommit = useGitAuthorAvatars(
		() => _props().repositoryKey,
		() =>
			_props()
				.commits.slice(viewportModel().visibleStart, viewportModel().visibleEnd)
				.filter((commit) => commit.itemKind === "commit")
				.slice(0, 100),
	);
	const lineLayerStyle = createMemo(() => ({
		"z-index": 0,
		left: px(graphModel().graphLeft),
	}));
	const normalizedQuery = createMemo(() => (query() ?? "").trim());
	createEffect(
		() => [normalizedQuery(), _props().onSearchChange] as const,
		([query, onSearchChange]) => {
			const timer = window.setTimeout(() => onSearchChange?.(query), 200);
			return () => window.clearTimeout(timer);
		},
	);
	const toggleColumn = (key: keyof ColumnVisibility) =>
		setPreference("columns", (cur) => ({
			...cur,
			[key]: !cur[key],
		}));
	const moveColumn = (source: ColumnKey, target: ColumnKey) => {
		setPreference("order", (order) =>
			rustProject("moveColumn", { order, source, target }),
		);
	};
	const openRefContextMenu = (ref: GitGraphRef, event: MouseEvent) => {
		setItemContextMenu(null);
		setRefContextMenu({
			ref,
			x: Math.max(8, Math.min(event.clientX, window.innerWidth - 232)),
			y: Math.max(8, Math.min(event.clientY, window.innerHeight - 460)),
		});
	};
	const openItemContextMenu = (item: GraphCommit, event: MouseEvent) => {
		setRefContextMenu(null);
		setItemContextMenu({
			item,
			x: Math.min(event.clientX, window.innerWidth - 224),
			y: Math.min(event.clientY, window.innerHeight - 260),
		});
	};
	const revealKeyboardRow = (index: number, repeat: boolean) => {
		const scroller = scrollerRef.current;
		if (!scroller || index < 0) return;
		const top = rustProject<number>("graphReveal", {
			index,
			scrollTop: scroller.scrollTop,
			height: scroller.clientHeight,
		});
		if (Math.abs(top - scroller.scrollTop) > 0.5)
			scroller.scrollTo({ top, behavior: repeat ? "instant" : "smooth" });
	};
	const navigateRows = (event: KeyboardEvent) => {
		const props = _props(),
			current = props.commits.find(
				(commit) => commit.id === props.selectedHash,
			);
		const branchTarget =
			event.key === "ArrowUp"
				? current?.navigation.branchNewer
				: current?.navigation.branchOlder;
		const next = rustProject<{
			handled: boolean;
			selectItem: string | null;
			selectIndex: number | null;
			openItem: string | null;
		}>("graphNavigation", {
			...repositoryKeyboardInput(event),
			items: props.presentation.selectableItems,
			current: props.selectedHash,
			branchTarget,
			canOpen: !!props.onOpenSelection,
		});
		if (!next.handled) return;
		keyboardNavigation = true;
		setHoveredRow(null);
		event.preventDefault();
		if (next.openItem) props.onOpenSelection?.(next.openItem);
		if (next.selectItem) {
			// Rows are virtualized and can disappear during selection/scrolling.
			// Keep keyboard focus on the persistent listbox before either changes.
			scrollerRef.current?.focus({ preventScroll: true });
			props.onSelect?.(next.selectItem);
			if (next.selectIndex !== null)
				revealKeyboardRow(next.selectIndex, event.repeat);
		}
	};
	const startColumnResize = (
		column: keyof ColumnWidths,
		event: PointerEvent,
	) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const startX = event.clientX;
		const startWidth = graphModel().columnWidths[column];
		const compact = graphModel().compact;
		let next = startWidth;
		trackResize(
			event.pointerId,
			(move) => {
				next = rustProject<number>("resizeGraphColumn", {
					column,
					width: startWidth + move.clientX - startX,
				});
				setResizing({ column, width: next, compact });
			},
			() => {
				setPreference(compact ? "compactWidths" : "widths", (current) => ({
					...current,
					[column]: next,
				}));
				setResizing(null);
			},
		);
	};
	return merge(_props, history, graphModel, viewportModel, preferences, {
		get worktreesByPath() {
			return worktreesByPath();
		},
		displayGraphColumn: (column: number) =>
			graphModel().displayColumns[column] ?? column,
		setHiddenRefs: (update: string[] | ((current: string[]) => string[])) =>
			setPreference("hiddenRefs", update),
		setSoloRefs: (update: string[] | ((current: string[]) => string[])) =>
			setPreference("soloRefs", update),
		setPinnedRefs: (update: string[] | ((current: string[]) => string[])) =>
			setPreference("pinnedRefs", update),
		get isColumnsOpen() {
			return isColumnsOpen();
		},
		setIsColumnsOpen,
		avatarForCommit,
		get selectedIdSet() {
			return selectedIdSet();
		},
		get hoveredRow() {
			return hoveredRow();
		},
		setHoveredRow,
		handleMouseMove,
		handleRowHover,
		headerRef,
		scrollerRef,
		get query() {
			return query();
		},
		setQuery,
		get refContextMenu() {
			return refContextMenu();
		},
		setRefContextMenu,
		get itemContextMenu() {
			return itemContextMenu();
		},
		setItemContextMenu,
		get lineLayerStyle() {
			return lineLayerStyle();
		},
		toggleColumn,
		moveColumn,
		rememberScroll,
		openRefContextMenu,
		openItemContextMenu,
		navigateRows,
		startColumnResize,
	});
}
export interface GraphSelectionIntent {
	additive: boolean;
	range: boolean;
}
export type ColumnVisibility = Record<ColumnKey, boolean>;
export type ColumnKey =
	"date" | "refs" | "graph" | "message" | "author" | "sha";
export interface ColumnWidths {
	date: number;
	refs: number;
	graph: number;
	message: number;
	author: number;
	sha: number;
}
export const TOOLS_WIDTH = 32;
export const ROW_HEIGHT = 23;
export const COLUMN_WIDTH = 18;
export const GRAPH_PADDING = 18;
export function hexToRgba(hex: string, alpha: number) {
	const c = hex.replace("#", "");
	const n = c.length === 3 ? c.replace(/[\s\S]/g, "$&$&") : c;
	return `rgba(${Number.parseInt(n.slice(0, 2), 16)}, ${Number.parseInt(n.slice(2, 4), 16)}, ${Number.parseInt(n.slice(4, 6), 16)}, ${alpha})`;
}
interface CommitGraphProps {
	searchQuery: string;
	searchActive: boolean;
	emptyLabel: string;
	onSearchChange?: (query: string) => void;
	commits: GraphCommit[];
	rows: GraphRow[];
	presentation: GraphPresentation;
	preferences: GraphPreferences;
	onPreferencesChange: (
		update:
			GraphPreferences | ((current: GraphPreferences) => GraphPreferences),
	) => void;
	selectedHash?: string;
	selectedIds: readonly string[];
	onSelect?: (itemId: string, intent?: GraphSelectionIntent) => void;
	worktrees?: GitWorktree[];
	branch?: string;
	onCheckoutRef?: (ref: string) => void;
	onRefDrop?: (source: string, target: string) => void;
	hasMore: boolean;
	onLoadMore?: () => void;
	loadingMore: boolean;
	repositoryKey?: string;
	onGraphAction?: (request: GitGraphActionRequest) => void;
	onCompareWithWip?: (itemId: string) => void;
	onOpenSelection?: (itemId: string) => void;
}
export type GitGraphActionRequest = Pick<
	NativeGitGraphActionRequest,
	"action" | "target" | "targets"
> & {
	itemId: string;
	suggestedName?: string;
};
interface GraphPreferences {
	columns: ColumnVisibility;
	widths: ColumnWidths;
	compactWidths: Partial<ColumnWidths>;
	order: ColumnKey[];
	hiddenRefs: string[];
	soloRefs: string[];
	pinnedRefs: string[];
}
const GRAPH_PREFERENCES_KEY = "commit-graph-columns-v13:global";
let sharedPreferences:
	[Accessor<GraphPreferences>, Setter<GraphPreferences>] | undefined;
export function useGraphPreferences(repositoryKey?: string) {
	const [read, set] = (sharedPreferences ??= createSignal(
		rustProject<GraphPreferences>(
			"graphPreferences",
			readStoredJson(GRAPH_PREFERENCES_KEY, null) ??
				readStoredJson(
					`commit-graph-columns-v12:${repositoryKey ?? "default"}`,
					{},
				),
		),
	));
	const update = (
		value: GraphPreferences | ((current: GraphPreferences) => GraphPreferences),
	) => {
		set((current) => {
			const next = typeof value === "function" ? value(current) : value;
			writeStoredJson(GRAPH_PREFERENCES_KEY, next);
			return next;
		});
	};
	return [read, update] as const;
}
export function nextGitGraphHistoryLimit(current: number): number {
	return rustProject("nextHistoryLimit", current);
}
