import type { ChatListRow, ChatWindow, CheckpointMeta } from "@contracts";
import * as stylex from "@stylexjs/stylex";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	flush,
	onSettled,
	untrack,
} from "solid-js";
import {
	bindImperativeRef,
	domStyle,
	type RefCell,
} from "../../../../shared/lib/dom.tsx";
import { project as rustProject } from "../../../../shared/lib/native.tsx";
import type { ChatMessage } from "../AgentChatView/useChatConnection.tsx";
import { ChatRenderRow } from "./ChatRenderRow.tsx";
import { chatViewportState } from "./chatViewportCache.ts";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
export type ChatVirtualizerControls = {
	scrollToEnd: (behavior?: ScrollBehavior) => void;
	isAtEnd: () => boolean;
	getDistanceFromEnd: () => number;
};
export const ChatMessageList = function ChatMessageList(_props: {
	active?: boolean;
	paneId: string;
	messages: ChatMessage[];
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
	const messageListRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const { messages, renderRows } = createChatListModel(
		() => _props.messages,
		() => _props.checkpoints,
	);
	const retainedViewport = untrack(() => chatViewportState(_props.paneId));
	const measuredHeights = { current: retainedViewport.heights };
	const [measurementVersion, setMeasurementVersion] = createSignal(0);
	const [scrollOffset, setScrollOffset] = createSignal<number | null>(null);
	const virtual = createMemo(() => renderRows().length > 60);
	const offsets = createMemo(() => {
		measurementVersion();
		return rustProject<number[]>(
			"chatOffsets",
			renderRows().map((row) => measuredHeights.current.get(row.key) ?? null),
		);
	});
	const [viewportHeight, setViewportHeight] = createSignal(800);
	let retainedWindow: ChatWindow | undefined;
	const _source = createMemo(() => {
		const next = rustProject<ChatWindow>("chatWindow", {
			offsets: offsets(),
			scrollOffset: _props.stickToBottom ? null : scrollOffset(),
			viewportHeight: viewportHeight(),
			retainedWindow,
		});
		retainedWindow = next;
		return next;
	});
	// Changes to firstVisible alone must not reconcile the mounted row list.
	const mountedWindow = createMemo(
		() => ({ start: _source().start, end: _source().end }),
		{
			equals: (before, after) =>
				before.start === after.start && before.end === after.end,
		},
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
					const list = messageListRef.current;
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
				const width =
					messageListRef.current?.clientWidth ?? element.clientWidth;
				if (width <= 0 || _props.active === false) return;
				if (width > 0 && retainedViewport.width !== width) {
					if (retainedViewport.width !== null) {
						measuredHeights.current.clear();
						// Cached heights from another width are estimates. Seed the
						// currently mounted rows together after layout, before offsets.
						for (const row of observedRows) {
							const key = row.dataset.chatRowKey;
							if (key)
								measuredHeights.current.set(
									key,
									row.getBoundingClientRect().height,
								);
						}
						setMeasurementVersion((version) => version + 1);
					}
					retainedViewport.width = width;
				}
				setViewportHeight(element.clientHeight);
				scheduleLayout();
				update();
			});
			viewportObserver.observe(element);
			setViewportHeight(element.clientHeight);
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
			const list = messageListRef.current;
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
			const firstVisible = rustProject<ChatWindow>("chatWindow", {
				offsets: offsets(),
				scrollOffset: liveOffset,
				viewportHeight: viewportHeight(),
			}).firstVisible;
			let changed = false;
			let adjustment = 0;
			for (const [row, height] of pendingMeasurements) {
				const key = row.dataset.chatRowKey;
				if (!row.isConnected || !key || height <= 0) continue;
				const previous = measuredHeights.current.get(key) ?? 160;
				if (Math.abs(previous - height) < 0.5) continue;
				measuredHeights.current.set(key, height);
				if (Number(row.dataset.chatRowIndex) < firstVisible)
					adjustment += height - previous;
				changed = true;
			}
			pendingMeasurements.clear();
			if (changed)
				flush(() => {
					if (virtual() && !_props.stickToBottom && liveOffset !== null)
						setScrollOffset(liveOffset + adjustment);
					setMeasurementVersion((version) => version + 1);
				});
			if (element) {
				if (_props.stickToBottom) pinToBottom();
				else if (virtual() && adjustment)
					element.scrollTop = previousTop + adjustment;
				const list = messageListRef.current;
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
			for (const key of measuredHeights.current.keys())
				if (!keys.has(key)) measuredHeights.current.delete(key);
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
			scrollToEnd: (behavior = "smooth") => {
				if (renderRows().length === 0) return;
				pinToBottom(behavior);
			},
			isAtEnd: () => {
				const el = _props.scrollElementRef.current;
				if (!el) return true;
				return el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
			},
			getDistanceFromEnd: () => {
				const el = _props.scrollElementRef.current;
				if (!el) return 0;
				return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
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
		const list = messageListRef.current;
		if (!list) return;
		// Row measurements, late image/Markdown layout and new messages share
		// one frame. No second observer is allowed to scroll independently.
		const observer = new ResizeObserver(scheduleLayout);
		observer.observe(list);
		return () => observer.disconnect();
	});
	return (
		<div
			ref={(element) => (messageListRef.current = element)}
			{...stylex.attrs(styles.messageList)}
		>
			{virtual() && (
				<div
					aria-hidden="true"
					style={domStyle(
						inlineStyles.getChatMessageListDivStyle(
							offsets()[mountedWindow().start],
						),
					)}
				/>
			)}
			{
				<For
					each={renderRows().slice(mountedWindow().start, mountedWindow().end)}
					keyed={(row) => row.key}
				>
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
								messages={messages}
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
					style={domStyle(
						inlineStyles.getChatMessageListDivStyle1(
							offsets()[renderRows().length]! - offsets()[mountedWindow().end]!,
						),
					)}
				/>
			)}
		</div>
	);
};

import { type Accessor, createProjection } from "solid-js";

/** Reconcile stream patches by message ID so text updates do not regroup the transcript. */
export function createChatListModel(
	source: Accessor<ChatMessage[]>,
	checkpoints: Accessor<CheckpointMeta[]>,
) {
	const messages = createProjection<ChatMessage[]>(source, [], { key: "id" });
	// Transcript snapshots retain unchanged message objects. Cache only row facts,
	// so streaming content does not subscribe grouping to every projected row.
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
	const facts = new WeakMap<ChatMessage, ReturnType<typeof describeRow>>();
	const rowFacts = createMemo(
		() =>
			source().map((message) => {
				let value = facts.get(message);
				if (!value) {
					value = describeRow(message);
					facts.set(message, value);
				}
				return value;
			}),
		{
			equals: (before, after) =>
				before.length === after.length &&
				before.every(
					(value, index) =>
						value === after[index] ||
						JSON.stringify(value) === JSON.stringify(after[index]),
				),
		},
	);
	const checkpointLinks = createMemo(
		() => checkpoints().map(({ afterMessageId }) => afterMessageId),
		{
			equals: (before, after) =>
				before.length === after.length &&
				before.every((id, index) => id === after[index]),
		},
	);
	const renderRows = createMemo(() =>
		rustProject<ChatListRow[]>("chatList", {
			messages: rowFacts(),
			checkpoints: checkpointLinks().map((afterMessageId) => ({
				afterMessageId,
			})),
		}),
	);
	return { messages, renderRows };
}
