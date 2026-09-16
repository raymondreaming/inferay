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
import { createPointerResize } from "@shared/lib/dom.tsx";
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
} from "solid-js";
import { getGraphLineLayerStyle } from "./styles.ts";
import { useGraphViewport } from "./useGraphViewport.tsx";

export function useCommitGraphState(_props: Accessor<CommitGraphProps>) {
	const trackResize = createPointerResize();
	const preferences = createMemo(() => _props().preferences);
	const setPreferences = createMemo(() => _props().onPreferencesChange);
	const setters = createMemo(() => {
		const field =
			<K extends keyof GraphPreferences>(key: K) =>
			(
				update:
					| GraphPreferences[K]
					| ((value: GraphPreferences[K]) => GraphPreferences[K]),
			) =>
				setPreferences()((current) => ({
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
	});
	const [isColumnsOpen, setIsColumnsOpen] = createSignal(false);
	const selectedIdSet = createMemo(() => {
		const _sourceValue2 = _props();
		return new Set(
			_sourceValue2.selectedIds === undefined
				? EMPTY_SELECTED_IDS
				: _sourceValue2.selectedIds,
		);
	});
	const [hoveredRow, setHoveredRow] = createSignal<string | null>(null);
	const keyboardNavigationRef = {
		current: false,
	};
	const mousePositionRef = {
		current: null,
	} as {
		current: {
			x: number;
			y: number;
		} | null;
	};
	const handleRowHover = (itemId: string | null) => {
		if (!keyboardNavigationRef.current) setHoveredRow(itemId);
	};
	const { scrollerRef, scrollTop, viewportHeight, rememberScroll } =
		useGraphViewport(
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
		() =>
			[
				_props().embedded,
				hasCommits(),
				_props().repositoryKey,
				scrollerRef.current,
			] as const,
		([embedded, ready, , scroller]) => {
			if (embedded && ready) scroller?.focus({ preventScroll: true });
		},
	);
	createEffect(
		() => !!itemContextMenu() || !!refContextMenu(),
		(open) => {
			if (!open) return;
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
		},
	);
	createEffect(
		() => [preferences(), _props().repositoryKey] as const,
		([value, repository]) => {
			writeStoredJson(preferencesKey(repository), value);
		},
	);
	const graphModel = createMemo(() => {
		const _source2Value = preferences(),
			_sourceValue7 = _props();
		return buildCommitGraphViewModel({
			columns: _source2Value.columns,
			commits: _sourceValue7.commits,
			order: _source2Value.order,
			presentation: _sourceValue7.presentation,
			widths: _source2Value.widths,
			worktrees:
				_sourceValue7.worktrees === undefined ? [] : _sourceValue7.worktrees,
		});
	});
	const viewportModel = createMemo(() => {
		const _sourceValue8 = _props();
		return projectCommitGraphViewport(
			_sourceValue8.rows,
			_sourceValue8.commits.length,
			scrollTop(),
			viewportHeight(),
			graphModel().displayColumns,
		);
	});
	const avatarForCommit = useGitAuthorAvatars(
		() => _props().repositoryKey,
		() =>
			_props()
				.commits.slice(viewportModel().visibleStart, viewportModel().visibleEnd)
				.filter((commit) => commit.itemKind === "commit")
				.slice(0, 100),
	);
	const lineLayerStyle = createMemo(() =>
		getGraphLineLayerStyle(graphModel().graphLeft, TOP_PADDING),
	);
	const normalizedQuery = createMemo(() => (query() ?? "").trim());
	createEffect(
		() => [normalizedQuery(), _props().onSearchChange] as const,
		([query, onSearchChange]) => {
			const timer = window.setTimeout(() => onSearchChange?.(query), 200);
			return () => window.clearTimeout(timer);
		},
	);
	const toggleColumn = (key: keyof ColumnVisibility) =>
		setters().setColumns((cur) => ({
			...cur,
			[key]: !cur[key],
		}));
	const moveColumn = (source: ColumnKey, target: ColumnKey) => {
		setters().setOrder((current) => moveGraphColumn(current, source, target));
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
		// Space pages files, never the graph. Leave nested controls usable.
		if (event.key === " ") {
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				(target.isContentEditable ||
					target.closest("input, textarea, select, button, a, [role='menu']"))
			)
				return;
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		// Left returns from the file sidebar, but has no action inside the graph.
		if (event.key === "ArrowLeft") {
			event.preventDefault();
			return;
		}
		const model = graphModel(),
			props = _props(),
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
			key: event.key,
			items: model.selectableItems,
			current: props.selectedHash,
			branch: event.altKey,
			branchTarget,
			canOpen: !!props.onOpenSelection,
		});
		if (!next.handled) return;
		keyboardNavigationRef.current = true;
		setHoveredRow(null);
		event.preventDefault();
		if (next.openItem) props.onOpenSelection?.(next.openItem);
		if (next.selectItem) {
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
		const startX = event.clientX;
		const startWidth = preferences().widths[column];
		const move = (moveEvent: PointerEvent) => {
			setters().setWidths((current) => ({
				...current,
				[column]: rustProject<number>("resizeGraphColumn", {
					column,
					width: startWidth + moveEvent.clientX - startX,
				}),
			}));
		};
		trackResize(event.pointerId, move);
	};
	return merge(_props, graphModel, viewportModel, preferences, {
		get emptyLabel() {
			return _props().emptyLabel ?? "No matching commits";
		},
		get searchActive() {
			return _props().searchActive ?? false;
		},
		get selectedIds() {
			return _props().selectedIds ?? EMPTY_SELECTED_IDS;
		},
		get class() {
			return _props().class ?? "";
		},
		get embedded() {
			return _props().embedded ?? false;
		},
		get hasMore() {
			return _props().hasMore ?? false;
		},
		get loadingMore() {
			return _props().loadingMore ?? false;
		},
		get setHiddenRefs() {
			const _source3Value = setters();
			return _source3Value.setHiddenRefs;
		},
		get setSoloRefs() {
			const _source3Value = setters();
			return _source3Value.setSoloRefs;
		},
		get setPinnedRefs() {
			const _source3Value = setters();
			return _source3Value.setPinnedRefs;
		},
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
		keyboardNavigationRef,
		mousePositionRef,
		handleRowHover,
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
	commits: GraphCommit[];
	rows: GraphRow[];
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
	class?: string;
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
export type GitGraphActionRequest = Pick<
	NativeGitGraphActionRequest,
	"action" | "target" | "targets"
> & {
	itemId: string;
	suggestedName?: string;
};
export interface GraphPreferences {
	columns: ColumnVisibility;
	widths: ColumnWidths;
	order: ColumnKey[];
	hiddenRefs: string[];
	soloRefs: string[];
	pinnedRefs: string[];
}
export const TOP_PADDING = ROW_HEIGHT;
export const EMPTY_SELECTED_IDS: readonly string[] = [];
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
export function nextGitGraphHistoryLimit(current: number): number {
	return rustProject("nextHistoryLimit", current);
}
export function moveGraphColumn(
	order: readonly ColumnKey[],
	source: ColumnKey,
	target: ColumnKey,
): ColumnKey[] {
	return rustProject("moveColumn", {
		order,
		source,
		target,
	});
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
		visibleOrder: ColumnKey[];
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
	const selectableItems = presentation.selectableItems;
	return {
		containingBranches: new Map(
			Object.entries(presentation.containingBranches),
		),
		defaultRemoteName: presentation.defaultRemoteName,
		displayGraphColumn,
		...geometry,
		hiddenRefDetails: presentation.hiddenRefDetails,
		hiddenRefNames: new Set(presentation.hiddenRefNames),
		matchingHashes: new Set(selectableItems),
		pinnedRefNames: new Set(presentation.pinnedRefNames),
		reachableHistory: new Set(presentation.reachableHistory),
		selectableItems,
		worktreesByPath: new Map(worktrees?.map((tree) => [tree.path, tree]) ?? []),
	};
}
function projectCommitGraphViewport(
	rows: readonly GraphRow[],
	itemCount: number,
	scrollTop: number,
	viewportHeight: number,
	displayColumns: number[],
) {
	const { visibleStart, visibleEnd } = rustProject<GraphViewport>(
		"graphViewport",
		{
			count: itemCount,
			scrollTop,
			height: viewportHeight,
		},
	);
	return {
		visibleStart,
		visibleEnd,
		lines: rustProject<GraphLines>("graphLines", {
			rows: rows.slice(visibleStart, visibleEnd),
			colors: runtimeGitGraphLaneColors,
			displayColumns,
		}),
	};
}
