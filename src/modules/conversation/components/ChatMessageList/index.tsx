import type { ChatListRow, ChatWindow, CheckpointMeta } from "@contracts";
import { bindImperativeRef, px, type RefCell } from "@shared/lib/dom.tsx";
import { ChatViewport, project as rustProject } from "@shared/lib/native.tsx";
import * as stylex from "@stylexjs/stylex";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	For,
	flush,
	onSettled,
	untrack,
} from "solid-js";
import type {
	ChatMessage,
	ChatSnapshot,
} from "../AgentChatView/useChatConnection.tsx";
import { ChatRenderRow } from "./ChatRenderRow.tsx";
import { styles } from "./styles.ts";
import {
	type ChatVirtualizerControls,
	chatViewportState,
} from "./useChatViewport.tsx";
export const ChatMessageList = function ChatMessageList(_props: {
	active?: boolean;
	paneId: string;
	transcript: ChatSnapshot;
	scrollElementRef: RefCell<HTMLDivElement | null>;
	virtualizerControlsRef?: (handle: ChatVirtualizerControls | null) => void;
	expandedTools: Set<string>;
	toggleTool: (id: string) => void;
	checkpoints: CheckpointMeta[];
	revertCheckpoint: (id: string) => void;
	handleSendMessage?: (text: string) => void;
	onMdFileClick?: (path: string) => void;
	slashCommandNames: readonly string[];
	stickToBottom: boolean;
}) {
	let messageList: HTMLDivElement | undefined;
	const renderRows = createChatListModel(
		() => _props.transcript,
		() => _props.checkpoints,
	);
	const retainedViewport = untrack(() => chatViewportState(_props.paneId));
	const measuredHeights = retainedViewport.heights;
	const [measurementVersion, setMeasurementVersion] = createSignal(0);
	const [widthVersion, setWidthVersion] = createSignal(0);
	const [scrollOffset, setScrollOffset] = createSignal<number | null>(
		retainedViewport.snapshot.following ? null : retainedViewport.snapshot.top,
	);
	const virtual = createMemo(() => renderRows().length > 60);
	const viewport = new ChatViewport();
	onSettled(() => () => viewport.free());
	const resetLayout = createMemo(
		() => {
			widthVersion();
			viewport.measure(
				Float64Array.from(
					renderRows(),
					(row) => measuredHeights.get(row.key) ?? 160,
				),
			);
			return viewport;
		},
		{ equals: false },
	);
	const layout = createMemo(
		() => {
			resetLayout();
			measurementVersion();
			return viewport;
		},
		{ equals: false },
	);
	const [viewportHeight, setViewportHeight] = createSignal(800);
	const _source = createMemo<ChatWindow>(() =>
		JSON.parse(
			layout().window(
				_props.stickToBottom ? undefined : (scrollOffset() ?? undefined),
				viewportHeight(),
			),
		),
	);
	// Changes to firstVisible alone must not reconcile the mounted row list.
	const mountedWindow = createMemo(
		() => ({ start: _source().start, end: _source().end }),
		{
			equals: (before, after) =>
				before.start === after.start && before.end === after.end,
		},
	);
	const mountedRows = createMemo(() =>
		renderRows().slice(mountedWindow().start, mountedWindow().end),
	);
	createEffect(
		() =>
			[
				_props.scrollElementRef.current,
				virtual(),
				_props.active !== false,
			] as const,
		([element, isVirtual, active]) => {
			if (!element || !isVirtual || !active) return;
			let frame = 0;
			const update = () => {
				if (frame) return;
				frame = requestAnimationFrame(() => {
					frame = 0;
					const list = messageList;
					if (!list || _props.active === false) return;
					setScrollOffset(
						Math.max(
							0,
							element.getBoundingClientRect().top -
								list.getBoundingClientRect().top,
						),
					);
				});
			};
			const viewportObserver = new ResizeObserver(() => {
				const width = messageList?.clientWidth ?? element.clientWidth;
				if (width <= 0 || _props.active === false) return;
				if (width > 0 && retainedViewport.width !== width) {
					if (retainedViewport.width !== null) {
						measuredHeights.clear();
						// Cached heights from another width are estimates. Seed the
						// currently mounted rows together after layout, before offsets.
						for (const row of observedRows) {
							const key = row.dataset.chatRowKey;
							if (key)
								measuredHeights.set(key, row.getBoundingClientRect().height);
						}
						setWidthVersion((version) => version + 1);
					}
					retainedViewport.width = width;
				}
				setViewportHeight(element.clientHeight);
				scheduleLayout();
				update();
			});
			viewportObserver.observe(element);
			element.addEventListener("scroll", update, {
				passive: true,
			});
			update();
			return () => {
				viewportObserver.disconnect();
				element.removeEventListener("scroll", update);
				if (frame) cancelAnimationFrame(frame);
			};
		},
	);
	// Read sizes in the observer; apply layout and scroll corrections next frame.
	// This avoids ResizeObserver feedback loops and browser scroll anchoring fighting ours.
	const pendingMeasurements = new Map<HTMLElement, number>();
	let measurementFrame = 0;
	const scheduleLayout = () => {
		if (measurementFrame) return;
		measurementFrame = requestAnimationFrame(() => {
			measurementFrame = 0;
			if (_props.active === false) {
				pendingMeasurements.clear();
				return;
			}
			const element = _props.scrollElementRef.current;
			const previousTop = element?.scrollTop ?? 0;
			const list = messageList;
			// The scroll listener publishes on another frame. Anchor measurements
			// to the current viewport, not its previous (possibly lower) position.
			const liveOffset =
				element && list
					? Math.max(
							0,
							element.getBoundingClientRect().top -
								list.getBoundingClientRect().top,
						)
					: scrollOffset();
			const firstVisible = layout().first_visible(
				liveOffset ?? undefined,
				viewportHeight(),
			);
			const measurements: number[] = [];
			const keys: Array<[string, number]> = [];
			for (const [row, height] of pendingMeasurements) {
				const key = row.dataset.chatRowKey;
				if (!row.isConnected || !key) continue;
				const index = Number(row.dataset.chatRowIndex);
				measurements.push(index, height);
				keys.push([key, index]);
			}
			pendingMeasurements.clear();
			const adjustment = viewport.update_measurements(
				Float64Array.from(measurements),
				firstVisible,
			);
			if (adjustment !== undefined) {
				for (const [key, index] of keys)
					measuredHeights.set(
						key,
						viewport.offset(index + 1) - viewport.offset(index),
					);
				flush(() => {
					if (virtual() && !_props.stickToBottom && liveOffset !== null)
						setScrollOffset(liveOffset + adjustment);
					setMeasurementVersion((version) => version + 1);
				});
			}
			if (element) {
				if (_props.stickToBottom) pinToBottom();
				else if (virtual() && adjustment)
					element.scrollTop = previousTop + adjustment;
				const list = messageList;
				if (list && !_props.stickToBottom)
					setScrollOffset(
						Math.max(
							0,
							element.getBoundingClientRect().top -
								list.getBoundingClientRect().top,
						),
					);
			}
		});
	};
	const handleMeasurements = (entries: ResizeObserverEntry[]) => {
		if (_props.active === false) return;
		for (const entry of entries)
			pendingMeasurements.set(
				entry.target as HTMLElement,
				entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height,
			);
		scheduleLayout();
	};
	const observedRows = new Set<HTMLDivElement>();
	let rowObserver: ResizeObserver | undefined;
	onSettled(() => {
		rowObserver = new ResizeObserver(handleMeasurements);
		for (const row of observedRows) rowObserver.observe(row);
		return () => {
			rowObserver?.disconnect();
			if (measurementFrame) cancelAnimationFrame(measurementFrame);
			pendingMeasurements.clear();
		};
	});
	const observeRow = (element: HTMLDivElement) => {
		observedRows.add(element);
		rowObserver?.observe(element);
		return () => {
			observedRows.delete(element);
			rowObserver?.unobserve(element);
			pendingMeasurements.delete(element);
		};
	};
	createEffect(
		() => renderRows().map((row) => row.key),
		(rowKeys) => {
			const keys = new Set(rowKeys);
			for (const key of measuredHeights.keys())
				if (!keys.has(key)) measuredHeights.delete(key);
		},
	);
	const pinToBottom = (behavior: ScrollBehavior = "auto") => {
		const element = _props.scrollElementRef.current;
		if (!element || _props.active === false) return;
		// A null offset asks Rust for the tail window. Using a pixel estimate
		// here and a DOM offset on scroll alternated windows as rows resized.
		if (virtual() && behavior !== "smooth") flush(() => setScrollOffset(null));
		if (behavior === "smooth") {
			element.scrollTo({
				top: element.scrollHeight,
				behavior,
			});
			return;
		}
		element.scrollTop = Math.max(
			0,
			element.scrollHeight - element.clientHeight,
		);
	};
	bindImperativeRef(
		() => _props.virtualizerControlsRef,
		() => ({
			scrollToEnd: (behavior = "auto") => {
				if (renderRows().length === 0) return;
				pinToBottom(behavior);
			},
		}),
	);
	createEffect(
		() =>
			[
				renderRows().length,
				_props.stickToBottom,
				_props.active !== false,
			] as const,
		() => {
			scheduleLayout();
		},
	);
	onSettled(() => {
		const list = messageList;
		if (!list) return;
		// Row measurements, late image/Markdown layout and new messages share
		// one frame. No second observer is allowed to scroll independently.
		const observer = new ResizeObserver(scheduleLayout);
		observer.observe(list);
		return () => observer.disconnect();
	});
	return (
		<div
			ref={(element) => (messageList = element)}
			{...stylex.attrs(styles.messageList)}
		>
			{virtual() && (
				<div
					aria-hidden="true"
					style={{
						height: px(layout().offset(mountedWindow().start)),
						"flex-shrink": 0,
					}}
				/>
			)}
			{
				<For each={mountedRows()} keyed={(row) => row.key}>
					{(item, windowIndex) => {
						const index = createMemo(
							() => mountedWindow().start + windowIndex(),
						);
						return (
							<ChatRenderRow
								observeRow={observeRow}
								item={item()}
								index={index()}
								rowKey={item().key}
								paneId={_props.paneId}
								expandedTools={_props.expandedTools}
								toggleTool={_props.toggleTool}
								messages={_props.transcript.messages}
								checkpoint={
									item().checkpoint === null
										? undefined
										: _props.checkpoints[item().checkpoint!]
								}
								revertCheckpoint={_props.revertCheckpoint}
								handleSendMessage={_props.handleSendMessage}
								onMdFileClick={_props.onMdFileClick}
								slashCommandNames={_props.slashCommandNames}
							/>
						);
					}}
				</For>
			}
			{virtual() && (
				<div
					aria-hidden="true"
					style={{
						height: px(
							layout().offset(renderRows().length) -
								layout().offset(mountedWindow().end),
						),
						"flex-shrink": 0,
					}}
				/>
			)}
		</div>
	);
};

/** Reconcile stream patches by message ID so text updates do not regroup the transcript. */
function createChatListModel(
	source: Accessor<ChatSnapshot>,
	checkpoints: Accessor<CheckpointMeta[]>,
) {
	// Snapshot ranges cover coalesced native replacements. Missed revisions and
	// browser-only edits fall back to comparing the full immutable snapshot.
	const describeRow = ({ id, role, isStreaming, render }: ChatMessage) => ({
		id,
		role,
		isStreaming,
		render: render
			? {
					kind: render.kind,
					hidden: render.hidden,
					groupLeader: render.groupLeader,
					groupEnd: render.groupEnd,
					filePath: render.filePath,
					continuesAfter: render.continuesAfter,
					rowId: render.rowId,
				}
			: null,
	});
	let previous: ChatSnapshot | undefined;
	const structureVersion = createMemo<number>((version = 0) => {
		const next = source();
		const range =
			previous && next.revision === previous.revision + 1
				? next.change
				: undefined;
		let changed =
			!previous || next.messages.length !== previous.messages.length;
		const end = Math.min(range?.end ?? Infinity, next.messages.length);
		for (let index = range?.start ?? 0; !changed && index < end; index++) {
			const message = next.messages[index]!;
			changed =
				message !== previous!.messages[index] &&
				JSON.stringify(describeRow(message)) !==
					JSON.stringify(describeRow(previous!.messages[index]!));
		}
		previous = next;
		return version + Number(changed);
	});
	const checkpointLinks = createMemo(
		() => checkpoints().map(({ afterMessageId }) => afterMessageId),
		{
			equals: (before, after) =>
				before.length === after.length &&
				before.every((id, index) => id === after[index]),
		},
	);
	return createMemo(() => {
		void structureVersion();
		const messages = untrack(source).messages;
		const rows = rustProject<ChatListRow[]>("chatList", {
			messages: messages.map(describeRow),
			checkpoints: checkpointLinks().map((afterMessageId) => ({
				afterMessageId,
			})),
		});
		// Reuse snapshot ID strings instead of retaining the JSON-decoded copies.
		for (const row of rows) {
			const message =
				messages[row.type === "edit-group" ? row.start : row.index]!;
			const key = message.render?.rowId ?? message.id;
			if (row.key === key) row.key = key;
		}
		return rows;
	});
}
