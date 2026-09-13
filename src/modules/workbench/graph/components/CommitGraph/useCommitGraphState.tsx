import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	merge,
} from "solid-js";
import type { GitGraphRef } from "../../../../../../build/presentation/contracts/GitGraphRef.ts";
import type { GitWorktree } from "../../../../../../build/presentation/contracts/GitWorktree.ts";
import type { GraphCommit } from "../../../../../../build/presentation/contracts/GraphCommit.ts";
import type { GraphLines } from "../../../../../../build/presentation/contracts/GraphLines.ts";
import type { GraphRow } from "../../../../../../build/presentation/contracts/GraphRow.ts";
import { runtimeGitGraphLaneColors } from "../../../../../design-system/styles.stylex.ts";
import { createPointerResize } from "../../../../../shared/lib/dom.tsx";
import {
	postJson,
	readStoredJson,
	project as rustProject,
	writeStoredJson,
} from "../../../../../shared/lib/native.tsx";
import type { GraphPresentation } from "../../../../repository/hooks/useGitGraph.tsx";
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
	const [commitAvatars, setCommitAvatars] = createSignal<
		Record<string, string | null>
	>({});
	const avatarHashes = createMemo(() =>
		_props()
			.commits.filter((commit) => commit.itemKind === "commit")
			.slice(0, 100)
			.map((commit) => commit.hash),
	);
	createEffect(
		() => [avatarHashes(), _props().repositoryKey] as const,
		([hashes, repository]) => {
			let current = true;
			if (!repository || hashes.length === 0) return;
			void resolveGitCommitAvatars(repository, hashes).then((avatars) => {
				if (current) setCommitAvatars(avatars);
			});
			return () => {
				current = false;
			};
		},
	);
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
		_props().repositoryKey;
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
		const rowTop = index * ROW_HEIGHT;
		const padding = ROW_HEIGHT * 2;
		const top =
			rowTop < scroller.scrollTop + padding
				? Math.max(0, rowTop - padding)
				: rowTop + ROW_HEIGHT >
						scroller.scrollTop + scroller.clientHeight - padding
					? rowTop + ROW_HEIGHT - scroller.clientHeight + padding
					: scroller.scrollTop;
		if (Math.abs(top - scroller.scrollTop) > 0.5)
			scroller.scrollTo({ top, behavior: repeat ? "instant" : "smooth" });
	};
	const navigateRows = (event: KeyboardEvent) => {
		// Left returns from the file sidebar, but has no action inside the graph.
		if (event.key === "ArrowLeft") {
			event.preventDefault();
			return;
		}
		const _source4Value = graphModel(),
			_sourceValue0 = _props();
		if (
			event.key !== "ArrowUp" &&
			event.key !== "ArrowDown" &&
			event.key !== "ArrowLeft" &&
			event.key !== "ArrowRight" &&
			event.key !== "Home" &&
			event.key !== "End"
		)
			return;
		if (!_source4Value.selectableItems.length) return;
		keyboardNavigationRef.current = true;
		setHoveredRow(null);
		event.preventDefault();
		const currentIndex = _sourceValue0.selectedHash
			? (_source4Value.itemIndexes.get(_sourceValue0.selectedHash) ?? -1)
			: -1;
		if (
			event.altKey &&
			(event.key === "ArrowUp" || event.key === "ArrowDown") &&
			_sourceValue0.selectedHash
		) {
			const current = _sourceValue0.commits[currentIndex];
			const next =
				event.key === "ArrowUp"
					? current?.navigation?.branchNewer
					: current?.navigation?.branchOlder;
			if (next) {
				const nextIndex = _source4Value.itemIndexes.get(next) ?? -1;
				_sourceValue0.onSelect?.(next);
				revealKeyboardRow(nextIndex, event.repeat);
			}
			return;
		}
		if (
			event.key === "ArrowRight" &&
			currentIndex >= 0 &&
			_sourceValue0.onOpenSelection
		) {
			_sourceValue0.onOpenSelection(
				_source4Value.selectableItems[currentIndex]!,
			);
			return;
		}
		if (event.key === "ArrowRight") return;
		const nextIndex =
			event.key === "Home"
				? 0
				: event.key === "End"
					? _source4Value.selectableItems.length - 1
					: currentIndex < 0
						? event.key === "ArrowUp"
							? _source4Value.selectableItems.length - 1
							: 0
						: Math.max(
								0,
								Math.min(
									_source4Value.selectableItems.length - 1,
									currentIndex + (event.key === "ArrowUp" ? -1 : 1),
								),
							);
		const next = _source4Value.selectableItems[nextIndex]!;
		_sourceValue0.onSelect?.(next);
		revealKeyboardRow(nextIndex, event.repeat);
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
				[column]: Math.max(
					MIN_COLUMN_WIDTHS[column],
					Math.min(MAX_COLUMN_WIDTH, startWidth + moveEvent.clientX - startX),
				),
			}));
		};
		trackResize(event.pointerId, move);
	};
	return merge(_props, {
		get containingBranches() {
			return graphModel().containingBranches;
		},
		get defaultRemoteName() {
			return graphModel().defaultRemoteName;
		},
		get displayGraphColumn() {
			return graphModel().displayGraphColumn;
		},
		get displayColumns() {
			return graphModel().displayColumns;
		},
		get visibleOrder() {
			return graphModel().visibleOrder;
		},
		get graphWidth() {
			return graphModel().graphWidth;
		},
		get graphLeft() {
			return graphModel().graphLeft;
		},
		get graphHeight() {
			return graphModel().graphHeight;
		},
		get tableWidth() {
			return graphModel().tableWidth;
		},
		get totalHeight() {
			return graphModel().totalHeight;
		},
		get hiddenRefDetails() {
			return graphModel().hiddenRefDetails;
		},
		get hiddenRefNames() {
			return graphModel().hiddenRefNames;
		},
		get itemIndexes() {
			return graphModel().itemIndexes;
		},
		get matchingHashes() {
			return graphModel().matchingHashes;
		},
		get pinnedRefNames() {
			return graphModel().pinnedRefNames;
		},
		get reachableHistory() {
			return graphModel().reachableHistory;
		},
		get selectableItems() {
			return graphModel().selectableItems;
		},
		get worktreesByPath() {
			return graphModel().worktreesByPath;
		},
		get visibleStart() {
			return viewportModel().visibleStart;
		},
		get visibleEnd() {
			return viewportModel().visibleEnd;
		},
		get lines() {
			return viewportModel().lines;
		},
		get emptyLabel() {
			const _sourceValue1 = _props();
			return _sourceValue1.emptyLabel === undefined
				? "No matching commits"
				: _sourceValue1.emptyLabel;
		},
		get searchActive() {
			const _sourceValue1 = _props();
			return _sourceValue1.searchActive === undefined
				? false
				: _sourceValue1.searchActive;
		},
		get selectedIds() {
			const _sourceValue1 = _props();
			return _sourceValue1.selectedIds === undefined
				? EMPTY_SELECTED_IDS
				: _sourceValue1.selectedIds;
		},
		get class() {
			const _sourceValue1 = _props();
			return _sourceValue1.class === undefined ? "" : _sourceValue1.class;
		},
		get embedded() {
			const _sourceValue1 = _props();
			return _sourceValue1.embedded === undefined
				? false
				: _sourceValue1.embedded;
		},
		get hasMore() {
			const _sourceValue1 = _props();
			return _sourceValue1.hasMore === undefined
				? false
				: _sourceValue1.hasMore;
		},
		get loadingMore() {
			const _sourceValue1 = _props();
			return _sourceValue1.loadingMore === undefined
				? false
				: _sourceValue1.loadingMore;
		},
		get columns() {
			const _source2Value2 = preferences();
			return _source2Value2.columns;
		},
		get widths() {
			const _source2Value2 = preferences();
			return _source2Value2.widths;
		},
		get order() {
			const _source2Value2 = preferences();
			return _source2Value2.order;
		},
		get setHiddenRefs() {
			const _source3Value = setters();
			return _source3Value.setHiddenRefs;
		},
		get soloRefs() {
			const _source2Value2 = preferences();
			return _source2Value2.soloRefs;
		},
		get setSoloRefs() {
			const _source3Value = setters();
			return _source3Value.setSoloRefs;
		},
		get pinnedRefs() {
			const _source2Value2 = preferences();
			return _source2Value2.pinnedRefs;
		},
		get setPinnedRefs() {
			const _source3Value = setters();
			return _source3Value.setPinnedRefs;
		},
		get isColumnsOpen() {
			return isColumnsOpen();
		},
		get setIsColumnsOpen() {
			return setIsColumnsOpen;
		},
		get commitAvatars() {
			return commitAvatars();
		},
		get selectedIdSet() {
			return selectedIdSet();
		},
		get hoveredRow() {
			return hoveredRow();
		},
		get setHoveredRow() {
			return setHoveredRow;
		},
		get keyboardNavigationRef() {
			return keyboardNavigationRef;
		},
		get mousePositionRef() {
			return mousePositionRef;
		},
		get handleRowHover() {
			return handleRowHover;
		},
		get scrollerRef() {
			return scrollerRef;
		},
		get query() {
			return query();
		},
		get setQuery() {
			return setQuery;
		},
		get refContextMenu() {
			return refContextMenu();
		},
		get setRefContextMenu() {
			return setRefContextMenu;
		},
		get itemContextMenu() {
			return itemContextMenu();
		},
		get setItemContextMenu() {
			return setItemContextMenu;
		},
		get lineLayerStyle() {
			return lineLayerStyle();
		},
		get toggleColumn() {
			return toggleColumn;
		},
		get moveColumn() {
			return moveColumn;
		},
		get rememberScroll() {
			return rememberScroll;
		},
		get openRefContextMenu() {
			return openRefContextMenu;
		},
		get openItemContextMenu() {
			return openItemContextMenu;
		},
		get navigateRows() {
			return navigateRows;
		},
		get startColumnResize() {
			return startColumnResize;
		},
	});
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
		itemIndexes: new Map(selectableItems.map((id, index) => [id, index])),
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
	const { start: visibleStart, end: visibleEnd } = graphVirtualRange(
		itemCount,
		Math.max(0, scrollTop - TOP_PADDING),
		viewportHeight,
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
