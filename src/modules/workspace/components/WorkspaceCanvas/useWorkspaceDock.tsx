import type {
	DockLayout,
	DockPointerTarget,
	DockRequest,
	DockTree,
	Pane,
} from "@contracts";
import {
	createPointerResize,
	lockPointerSelection,
	type RefCell,
} from "@shared/lib/dom.tsx";
import { DockSession, project, readStoredValue } from "@shared/lib/native.tsx";
import { saveWorkspaceDock } from "@workspace/services/workspaceApi.ts";
import {
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onSettled,
	untrack,
} from "solid-js";

export const ROOT_DOCK_TARGET_ID = "__workspace-root__";

function createDockLayout(input: () => DockRequest, active: () => boolean) {
	const model = new DockSession();
	const begin = (request: DockRequest, deduplicate = false) => {
		const read = (prefix: string) =>
			readStoredValue(`${prefix}:${request.workspaceId}`) ??
			(request.legacyWorkspaceId
				? readStoredValue(`${prefix}:${request.legacyWorkspaceId}`)
				: null) ??
			undefined;
		return JSON.parse(
			model.begin(
				JSON.stringify(request),
				read("native-workspace-dock"),
				read("agent-workspace-dock"),
				deduplicate,
			),
		) as {
			revision: number;
			layout: DockLayout | null;
			persist: boolean;
		} | null;
	};
	const initial = begin(untrack(input))!;
	const [layout, setLayout] = createSignal<DockLayout>(initial.layout!);
	const tree = createMemo(() => layout().tree);
	const [error, setError] = createSignal<string | null>(null);
	let requests = Promise.resolve();
	const update = (
		action?: Record<string, unknown>,
		target = input(),
		deduplicate = false,
	) => {
		const request = { ...target, action };
		const pending = begin(request, deduplicate);
		if (!pending) return Promise.resolve(true);
		if (pending.layout) setLayout(pending.layout);
		if (!pending.persist) return Promise.resolve(true);
		const result = requests.then(async () => {
			if (deduplicate && !model.is_current(pending.revision)) return true;
			try {
				const saved = await saveWorkspaceDock<DockLayout>(request);
				const accepted = JSON.parse(
					model.accept(
						pending.revision,
						request.workspaceId,
						JSON.stringify(saved),
					),
				) as DockLayout | null;
				if (accepted?.canvas && "tree" in accepted) setLayout(accepted);
				if (model.is_current(pending.revision)) setError(null);
				return true;
			} catch {
				if (model.fail(pending.revision))
					setError("Could not save pane layout. Please retry.");
				return false;
			}
		});
		requests = result.then(() => {});
		return result;
	};
	createEffect(
		() => (active() ? input() : null),
		(target) => {
			if (target) void update(undefined, target, true);
		},
	);
	onSettled(() => () => {
		model.dispose();
		void requests.then(() => model.free());
	});
	return { error, layout, setLayout, tree, update };
}

function observeResponsiveGridColumns(
	container: () => HTMLElement | null,
	columns: () => number,
	setAvailableColumns: (value: (current: number) => number) => void,
) {
	createEffect(columns, (configuredColumns) => {
		const element = container();
		if (!element) return;
		const update = (width: number) => {
			if (width <= 0) return;
			const next = project<number>("responsiveDockColumns", {
				width,
				columns: configuredColumns,
			});
			setAvailableColumns((current) => (current === next ? current : next));
		};
		const observer = new ResizeObserver((entries) => {
			const width = entries[0]?.contentRect.width;
			if (width !== undefined) update(width);
		});
		observer.observe(element);
		return () => observer.disconnect();
	});
}

export function useWorkspaceDock(
	props: {
		active?: boolean;
		panes: readonly Pick<Pane, "id">[];
		columns: number;
		rows: number;
		workspaceId?: string;
		legacyWorkspaceId?: string;
		onSelectPane: (id: string) => void;
	},
	containerRef: RefCell<HTMLDivElement | null>,
) {
	const trackResize = createPointerResize();
	const [dragPanelId, setDragPanelId] = createSignal<string | null>(null);
	const [availableGridColumns, setAvailableGridColumns] = createSignal(
		() => props.columns,
	);
	const [dockTarget, setDockTarget] = createSignal<DockPointerTarget | null>(
		null,
	);
	const panelKey = createMemo(() =>
		JSON.stringify(props.panes.map((pane) => pane.id)),
	);
	const dockInput = createMemo(() => ({
		workspaceId: props.workspaceId ?? "default",
		legacyWorkspaceId: props.legacyWorkspaceId,
		ids: JSON.parse(panelKey()) as string[],
		columns: props.columns,
		visibleColumns: availableGridColumns(),
		rows: props.rows,
	}));
	const dock = createDockLayout(dockInput, () => props.active !== false);
	const clearDragState = () => {
		setDragPanelId(null);
		setDockTarget(null);
	};
	observeResponsiveGridColumns(
		() => containerRef.current,
		() => props.columns,
		setAvailableGridColumns,
	);
	const commitDockPlacement = (sourceId: string, target: DockPointerTarget) => {
		void dock
			.update({
				type: "place",
				source: sourceId,
				target: target.id,
				edge: target.edge,
				insert: false,
				outer: target.id === ROOT_DOCK_TARGET_ID && target.edge !== "center",
			})
			.then((saved) => {
				if (!saved) return;
				if (props.panes.some((pane) => pane.id === sourceId))
					props.onSelectPane(sourceId);
			});
	};
	let cancelDockDrag: (() => void) | undefined;
	onCleanup(() => cancelDockDrag?.());
	const beginPointerDock = (event: PointerEvent, sourceId: string) => {
		if (event.button !== 0) return;
		cancelDockDrag?.();
		event.preventDefault();
		event.stopPropagation();
		const releaseSelection = lockPointerSelection();
		const source = event.currentTarget as HTMLElement | null;
		const pointerId = event.pointerId;
		const startX = event.clientX;
		const startY = event.clientY;
		let activated = false;
		let finished = false;
		let target: DockPointerTarget | null = null;
		try {
			source?.setPointerCapture(pointerId);
		} catch {}
		const updateTarget = (moveEvent: PointerEvent) => {
			if (moveEvent.pointerId !== pointerId) return;
			if (!activated) {
				const distance = Math.hypot(
					moveEvent.clientX - startX,
					moveEvent.clientY - startY,
				);
				if (distance < 3) return;
				activated = true;
				setDragPanelId(sourceId);
			}
			moveEvent.preventDefault();
			const root = containerRef.current;
			if (!root) return;
			const hit = document.elementFromPoint(
				moveEvent.clientX,
				moveEvent.clientY,
			);
			const cell = hit?.closest<HTMLElement>("[data-agent-grid-pane-id]");
			target = project<DockPointerTarget | null>("dockPointerTarget", {
				x: moveEvent.clientX,
				y: moveEvent.clientY,
				root: root.getBoundingClientRect(),
				panelCount: dockInput().ids.length,
				source: sourceId,
				insert: false,
				cellId: cell?.dataset.agentGridPaneId,
				cell: cell?.getBoundingClientRect(),
			});
			setDockTarget(target);
		};
		const finish = (finishEvent: PointerEvent | null, commit: boolean) => {
			if (finishEvent && finishEvent.pointerId !== pointerId) return;
			if (finished) return;
			finished = true;
			cancelDockDrag = undefined;
			window.removeEventListener("pointermove", updateTarget);
			window.removeEventListener("pointerup", finishDrop);
			window.removeEventListener("pointercancel", cancelDrop);
			window.removeEventListener("blur", cancelAbandonedDrag);
			source?.removeEventListener("lostpointercapture", cancelAbandonedDrag);
			try {
				source?.releasePointerCapture(pointerId);
			} catch {}
			releaseSelection();
			if (commit && activated && target) {
				commitDockPlacement(sourceId, target);
			} else if (commit && !activated) {
				props.onSelectPane(sourceId);
			}
			clearDragState();
		};
		const finishDrop = (finishEvent: PointerEvent) => finish(finishEvent, true);
		const cancelDrop = (finishEvent: PointerEvent) =>
			finish(finishEvent, false);
		const cancelAbandonedDrag = () => finish(null, false);
		cancelDockDrag = cancelAbandonedDrag;
		window.addEventListener("pointermove", updateTarget);
		window.addEventListener("pointerup", finishDrop);
		window.addEventListener("pointercancel", cancelDrop);
		window.addEventListener("blur", cancelAbandonedDrag);
		source?.addEventListener("lostpointercapture", cancelAbandonedDrag);
	};
	const handleDividerPointerDown = (
		event: PointerEvent & {
			currentTarget: HTMLButtonElement;
		},
		path: readonly ("first" | "second")[],
		direction: "horizontal" | "vertical",
	) => {
		const splitElement = event.currentTarget.parentElement;
		if (event.button !== 0 || !splitElement) return;
		event.preventDefault();
		const pointerId = event.pointerId;
		event.currentTarget.setPointerCapture?.(pointerId);
		let finalRatio: number | undefined;
		const resize = (moveEvent: PointerEvent) => {
			const rect = splitElement.getBoundingClientRect();
			const ratio =
				direction === "horizontal"
					? (moveEvent.clientX - rect.left) / Math.max(1, rect.width)
					: (moveEvent.clientY - rect.top) / Math.max(1, rect.height);
			finalRatio = ratio;
			dock.setLayout((current) => {
				const rendered = current.tree;
				return {
					...current,
					tree: rendered
						? project<DockTree>("resizeDockSplit", {
								tree: rendered,
								path,
								ratio,
							})
						: rendered,
				};
			});
		};
		trackResize(pointerId, resize, () => {
			if (finalRatio !== undefined)
				void dock.update({
					type: "resize",
					path,
					ratio: finalRatio,
				});
		});
	};
	createEffect(
		() => props.active !== false,
		(active) => {
			if (!active) cancelDockDrag?.();
		},
	);

	return {
		layout: dock.layout,
		tree: dock.tree,
		error: dock.error,
		reload: dock.update,
		dragPanelId,
		target: dockTarget,
		beginDrag: beginPointerDock,
		resize: handleDividerPointerDown,
	};
}
