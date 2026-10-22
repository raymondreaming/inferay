import type {
	DockPointerTarget,
	DockTree,
	DockWheel,
	Pane,
	WorkspaceAgentKind,
} from "@contracts";
import {
	type AgentChatHandle,
	AgentChatView,
} from "@conversation/components/AgentChatView/index.tsx";
import { surfaceStyles } from "@design-system/styles.stylex.ts";
import { captureEvent, px } from "@shared/lib/dom.tsx";
import {
	isChatAgentKind,
	loadDefaultChatSettings,
	project,
} from "@shared/lib/native.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { ErrorBoundary } from "@shared/ui/ErrorBoundary/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, For, Show } from "solid-js";
import { DockSplit } from "./DockSplit.tsx";
import { ROOT_DOCK_TARGET_ID, useWorkspaceDock } from "./useWorkspaceDock.tsx";

type DockSplitNode = Extract<DockTree, { readonly type: "split" }>;

import { styles } from "./styles.ts";

function containChatSelection(
	active: () => boolean,
	container: () => HTMLElement | null,
) {
	createEffect(active, (isActive) => {
		if (!isActive) return;
		const contain = () => {
			const selection = window.getSelection();
			if (
				!selection ||
				selection.isCollapsed ||
				!selection.anchorNode ||
				!selection.focusNode
			)
				return;
			const anchor = selection.anchorNode;
			const pane = (
				anchor instanceof Element ? anchor : anchor.parentElement
			)?.closest("[data-chat-pane-id]");
			if (
				!pane ||
				!container()?.contains(pane) ||
				pane.contains(selection.focusNode)
			)
				return;
			const bounds = document.createRange();
			bounds.selectNodeContents(pane);
			const before =
				bounds.comparePoint(selection.focusNode, selection.focusOffset) < 0;
			selection.setBaseAndExtent(
				anchor,
				selection.anchorOffset,
				pane,
				before ? 0 : pane.childNodes.length,
			);
		};
		document.addEventListener("selectionchange", contain);
		return () => document.removeEventListener("selectionchange", contain);
	});
}

type DockEdge = DockPointerTarget["edge"];
const isWorkspaceDockDragSource = (target: EventTarget | null) =>
	target instanceof Element &&
	!!target.closest('[data-workspace-dock-drag-source="true"]');
const shouldFocusPaneComposer = (target: EventTarget | null) =>
	!(target instanceof Element) ||
	(!target.closest("button,input,textarea,select,a,[contenteditable='true']") &&
		window.getSelection()?.isCollapsed !== false);

interface WorkspaceCanvasProps {
	active?: boolean;
	panes: Pane[];
	selectedPaneId: string | null;
	columns: number;
	rows: number;
	onSelectPane: (id: string) => void;
	onFocusPane?: (id: string) => void;
	onClosePane: (id: string) => void;
	onDirectorySelect: (
		id: string,
		path: string | null,
		references?: string[],
	) => void;
	onDirectoryCancel: (id: string) => void;
	onChatRef: (id: string, handle: AgentChatHandle | null) => void;
	onSetPaneAgentKind?: (id: string, kind: WorkspaceAgentKind) => void;
	workspaceId?: string;
	legacyWorkspaceId?: string;
}

function dropEdgeStyle(edge: DockEdge | null) {
	if (edge === "left") return styles.dropLeft;
	if (edge === "right") return styles.dropRight;
	if (edge === "top") return styles.dropTop;
	if (edge === "bottom") return styles.dropBottom;
	return styles.dropCenter;
}
export const WorkspaceCanvas = function WorkspaceCanvas(
	props: WorkspaceCanvasProps,
) {
	const containerRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	containChatSelection(
		() => props.active !== false,
		() => containerRef.current,
	);
	const dock = useWorkspaceDock(props, containerRef);
	const handleWheelCapture = (event: WheelEvent) => {
		const canvas = containerRef.current;
		const target =
			event.target instanceof Element
				? event.target.closest<HTMLElement>("[data-agent-grid-pane-id]")
				: null;
		if (!canvas || !target) return;
		const selected = target.dataset.agentGridPaneId === props.selectedPaneId;
		let inner: HTMLElement | null = null;
		if (selected) {
			const isScroller = (element: HTMLElement) =>
				["auto", "scroll"].includes(getComputedStyle(element).overflowY) &&
				element.scrollHeight > element.clientHeight;
			let element = event.target instanceof HTMLElement ? event.target : null;
			while (element && element !== target) {
				if (isScroller(element)) {
					inner = element;
					break;
				}
				element = element.parentElement;
			}
			if (!inner) {
				const messages = target.querySelector<HTMLElement>(
					"[data-chat-scroll-area]",
				);
				if (messages && isScroller(messages)) inner = messages;
			}
		}
		const wheel = project<DockWheel>("dockWheel", {
			deltaY: event.deltaY,
			selected,
			inner: inner && {
				offset: inner.scrollTop,
				size: inner.clientHeight,
				extent: inner.scrollHeight,
			},
		});
		if (!wheel.capture) return;
		event.preventDefault();
		event.stopPropagation();
		canvas.scrollTop += wheel.delta;
	};
	return (
		<div {...stylex.attrs(styles.root)}>
			{dock.error() && (
				<div role="alert" {...stylex.attrs(surfaceStyles.errorNotice)}>
					<span {...stylex.attrs(surfaceStyles.errorMessage)}>
						{dock.error()}
					</span>
					<Button size="sm" onClick={() => void dock.reload()}>
						Reload layout
					</Button>
				</div>
			)}
			{(() => {
				const DockNode = (nodeProps: {
					node: DockTree;
					path: readonly ("first" | "second")[];
				}): import("solid-js").Element => {
					const split = createMemo(() =>
						nodeProps.node.type === "split" ? nodeProps.node : undefined,
					);
					const branch = createMemo<DockSplitNode | undefined>(
						(previous) => split() ?? previous,
					);
					return (
						<Show
							when={split()}
							fallback={
								<DockPanel
									id={nodeProps.node.type === "panel" ? nodeProps.node.id : ""}
								/>
							}
						>
							{(_branch) => (
								<DockSplit
									direction={branch()?.direction ?? "horizontal"}
									ratio={branch()?.ratio ?? 0.5}
									resizable={
										branch()?.first.type !== "empty" &&
										branch()?.second.type !== "empty"
									}
									first={
										<DockNode
											node={branch()?.first ?? nodeProps.node}
											path={[...nodeProps.path, "first"]}
										/>
									}
									second={
										<DockNode
											node={branch()?.second ?? nodeProps.node}
											path={[...nodeProps.path, "second"]}
										/>
									}
									onResize={(event) =>
										dock.resize(
											event,
											nodeProps.path,
											branch()?.direction ?? "horizontal",
										)
									}
								/>
							)}
						</Show>
					);
				};
				const DockPanel = (panelProps: {
					id: string;
				}): import("solid-js").Element => {
					const pane = createMemo(() =>
						props.panes.find((pane) => pane.id === panelProps.id),
					);
					const isDropTarget = createMemo(
						() =>
							dock.target()?.id === panelProps.id &&
							dock.dragPanelId() !== panelProps.id,
					);
					return (
						<div
							data-agent-grid-pane-id={panelProps.id}
							{...stylex.attrs(styles.dockCell)}
							ref={[
								captureEvent("pointerdown", (event) => {
									const currentPane = pane();
									if (isWorkspaceDockDragSource(event.target)) return;
									if (currentPane) {
										if (currentPane.id !== props.selectedPaneId) {
											window.getSelection()?.removeAllRanges();
										}
										props.onSelectPane(currentPane.id);
										return;
									}
								}),
								captureEvent("click", (event) => {
									const currentPane = pane();
									if (isWorkspaceDockDragSource(event.target)) {
										if (currentPane) props.onSelectPane(currentPane.id);
									}
									if (currentPane && shouldFocusPaneComposer(event.target)) {
										props.onFocusPane?.(currentPane.id);
									}
								}),
							]}
						>
							<For each={pane() ? [pane()!] : []} keyed={(item) => item.id}>
								{(item) => (
									<ErrorBoundary label="Chat pane" contained>
										<AgentChatView
											paneId={item().id}
											cwd={item().cwd}
											referencePaths={item().referencePaths}
											pendingWorkspacePaths={item().pendingWorkspacePaths}
											agentKind={
												isChatAgentKind(item().agentKind)
													? item().agentKind
													: undefined
											}
											isSelected={
												props.active !== false &&
												item().id === props.selectedPaneId
											}
											isVisible={props.active !== false}
											onClose={props.onClosePane}
											onDirectoryChange={(id, cwd, refs) => {
												if (!isChatAgentKind(item().agentKind))
													props.onSetPaneAgentKind?.(
														id,
														loadDefaultChatSettings().agentKind,
													);
												props.onDirectorySelect(id, cwd, refs);
											}}
											onDirectoryCancel={props.onDirectoryCancel}
											draggable
											onDragStart={(event) => dock.beginDrag(event, item().id)}
											ref={(handle) => props.onChatRef(item().id, handle)}
										/>
									</ErrorBoundary>
								)}
							</For>
							{isDropTarget() ? (
								<div
									aria-hidden="true"
									{...stylex.attrs(
										styles.dropIndicator,
										dropEdgeStyle(dock.target()?.edge ?? null),
									)}
								/>
							) : null}
						</div>
					);
				};
				return (
					<div
						ref={[
							(element) => (containerRef.current = element),
							captureEvent("wheel", (event) => handleWheelCapture(event)),
						]}
						{...stylex.attrs(styles.dockRoot)}
						data-agent-grid-scroll-area
					>
						<div
							{...stylex.attrs(
								styles.dockCanvas,
								dock.layout().canvas.sparse && styles.dockCanvasSparse,
							)}
							style={{
								"min-height": px(dock.layout().canvas.minHeight),
								width: px(dock.layout().canvas.width),
							}}
						>
							{
								<Show when={dock.tree()}>
									{(tree) => <DockNode node={tree()} path={[]} />}
								</Show>
							}
						</div>
						{dock.target()?.id === ROOT_DOCK_TARGET_ID ? (
							<div
								aria-hidden="true"
								{...stylex.attrs(
									styles.dropIndicator,
									styles.rootDropIndicator,
									dropEdgeStyle(dock.target()!.edge),
								)}
							/>
						) : null}
					</div>
				);
			})()}
		</div>
	);
};
