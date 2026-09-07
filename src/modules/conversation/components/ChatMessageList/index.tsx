import * as stylex from "@stylexjs/stylex";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	flush,
	onSettled,
} from "solid-js";
import type { ChatWindow } from "../../../../../build/presentation/contracts/ChatWindow.ts";
import type { CheckpointMeta } from "../../../../../build/presentation/contracts/CheckpointMeta.ts";
import {
	bindImperativeRef,
	domStyle,
	type RefCell,
} from "../../../../shared/lib/dom.tsx";
import { project as rustProject } from "../../../../shared/lib/native.tsx";
import type { ChatMessage } from "../AgentChatView/useChatConnection.tsx";
import { ChatRenderRow } from "./ChatRenderRow.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
export type ChatVirtualizerControls = {
	scrollToEnd: (behavior?: ScrollBehavior) => void;
	isAtEnd: () => boolean;
	getDistanceFromEnd: () => number;
};
export const ChatMessageList = function ChatMessageList(_props: {
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
	const didInitialScrollRef = {
		current: false,
	};
	const messageListRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const { messages, renderRows } = createChatListModel(
		() => _props.messages,
		() => _props.checkpoints,
	);
	const measuredHeights = {
		current: new Map<string, number>(),
	};
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
	const _source = createMemo(() =>
		rustProject<ChatWindow>("chatWindow", {
			offsets: offsets(),
			scrollOffset: scrollOffset(),
			viewportHeight: viewportHeight(),
		}),
	);
	createEffect(
		() => [_props.scrollElementRef, virtual()],
		() => {
			const element = _props.scrollElementRef.current;
			if (!element || !virtual()) return;
			let frame = 0;
			const update = () => {
				if (frame) return;
				frame = requestAnimationFrame(() => {
					frame = 0;
					const list = messageListRef.current;
					if (!list) return;
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
				setViewportHeight(element.clientHeight);
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
	const handleMeasurements = (entries: ResizeObserverEntry[]) => {
		for (const entry of entries)
			pendingMeasurements.set(
				entry.target as HTMLElement,
				entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height,
			);
		if (measurementFrame) return;
		measurementFrame = requestAnimationFrame(() => {
			measurementFrame = 0;
			const element = _props.scrollElementRef.current;
			const previousTop = element?.scrollTop ?? 0;
			const atEnd =
				!!element &&
				element.scrollHeight - previousTop - element.clientHeight <= 80;
			const firstVisible = _source().firstVisible;
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
			if (!changed) return;
			flush(() => setMeasurementVersion((version) => version + 1));
			if (element) {
				if (atEnd || _props.stickToBottom)
					element.scrollTop = element.scrollHeight;
				else if (adjustment) element.scrollTop = previousTop + adjustment;
				const list = messageListRef.current;
				if (list)
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
		() => [renderRows()],
		() => {
			const keys = new Set(renderRows().map((row) => row.key));
			for (const key of measuredHeights.current.keys())
				if (!keys.has(key)) measuredHeights.current.delete(key);
		},
	);
	const pinToBottom = (behavior: ScrollBehavior = "auto") => {
		const element = _props.scrollElementRef.current;
		if (!element) return;
		// Mount the final window before reading its DOM height. Otherwise a stale
		// scroll offset can replace the bottom rows while estimates are settling.
		if (virtual() && behavior !== "smooth") {
			flush(() =>
				setScrollOffset(
					Math.max(0, offsets()[renderRows().length]! - element.clientHeight),
				),
			);
		}
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
		() => [pinToBottom, renderRows().length, _props.scrollElementRef],
		() => {
			if (renderRows().length === 0) return;
			if (!didInitialScrollRef.current) {
				didInitialScrollRef.current = true;
				let raf2 = 0;
				const raf1 = requestAnimationFrame(() => {
					pinToBottom();
					raf2 = requestAnimationFrame(() => {
						pinToBottom();
					});
				});
				return () => {
					cancelAnimationFrame(raf1);
					if (raf2) cancelAnimationFrame(raf2);
				};
			}
			const scrollElement = _props.scrollElementRef.current;
			if (scrollElement) {
				const distanceFromBottom =
					scrollElement.scrollHeight -
					scrollElement.scrollTop -
					scrollElement.clientHeight;
				// Only auto-stick to the bottom when the user is already there.
				// Yanking the viewport mid-read is both jarring and an extra
				// layout/paint we can't afford on every new message.
				if (distanceFromBottom > 120) return;
			}
			const raf = requestAnimationFrame(() => {
				pinToBottom();
			});
			return () => cancelAnimationFrame(raf);
		},
	);
	createEffect(
		() => [pinToBottom, _props.stickToBottom],
		() => {
			const list = messageListRef.current;
			if (
				!list ||
				!_props.stickToBottom ||
				typeof ResizeObserver === "undefined"
			)
				return;
			let frame = 0;
			const observer = new ResizeObserver(() => {
				if (frame) return;
				frame = requestAnimationFrame(() => {
					frame = 0;
					pinToBottom();
				});
			});
			observer.observe(list);
			return () => {
				observer.disconnect();
				if (frame) cancelAnimationFrame(frame);
			};
		},
	);
	createEffect(
		() => [renderRows().length],
		() => {
			if (renderRows().length > 0) return;
			didInitialScrollRef.current = false;
		},
	);
	return (
		<div
			ref={(element) => (messageListRef.current = element)}
			{...stylex.attrs(styles.messageList)}
		>
			{virtual() && (
				<div
					aria-hidden="true"
					style={domStyle(
						inlineStyles.getChatMessageListDivStyle(offsets()[_source().start]),
					)}
				/>
			)}
			{
				<For
					each={renderRows().slice(_source().start, _source().end)}
					keyed={(row) => row.key}
				>
					{(item, windowIndex) => {
						const index = createMemo(() => _source().start + windowIndex());
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
							offsets()[renderRows().length]! - offsets()[_source().end]!,
						),
					)}
				/>
			)}
		</div>
	);
};

import { type Accessor, createProjection } from "solid-js";

import type { ChatListRow } from "../../../../../build/presentation/contracts/ChatListRow.ts";

/** Reconcile stream patches by message ID so text updates do not regroup the transcript. */
export function createChatListModel(
	source: Accessor<ChatMessage[]>,
	checkpoints: Accessor<CheckpointMeta[]>,
) {
	const messages = createProjection<ChatMessage[]>(source, [], { key: "id" });
	const renderRows = createMemo(() =>
		rustProject<ChatListRow[]>("chatList", {
			messages: messages.map(({ id, role, isStreaming, render }) => ({
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
			})),
			checkpoints: checkpoints().map(({ afterMessageId }) => ({
				afterMessageId,
			})),
		}),
	);
	return { messages, renderRows };
}
