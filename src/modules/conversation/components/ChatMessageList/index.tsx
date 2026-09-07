import * as stylex from "@octanejs/stylex";
import {
	memo,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "octane";
import type React from "react";
import type { ChatListRow } from "../../../../../build/presentation/contracts/ChatListRow.ts";
import type { ChatWindow } from "../../../../../build/presentation/contracts/ChatWindow.ts";
import type { CheckpointMeta } from "../../../../../build/presentation/contracts/CheckpointMeta.ts";
import { project as rustProject } from "../../../../adapters/presentation/model.ts";
import type { ChatMessage } from "../AgentChatView/useChatConnection.tsx";
import { ChatRenderRow } from "./ChatRenderRow.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

export type ChatVirtualizerControls = {
	scrollToEnd: (behavior?: ScrollBehavior) => void;
	isAtEnd: () => boolean;
	getDistanceFromEnd: () => number;
};

export const ChatMessageList = memo(function ChatMessageList({
	paneId,
	messages,
	scrollElementRef,
	virtualizerControlsRef,
	expandedTools,
	toggleTool,
	checkpoints,
	revertCheckpoint,
	handleSendMessage,
	onMdFileClick,
	slashCommandNames,
	stickToBottom,
}: {
	paneId: string;
	messages: ChatMessage[];
	scrollElementRef: React.RefObject<HTMLDivElement | null>;
	virtualizerControlsRef?: React.Ref<ChatVirtualizerControls | null>;
	expandedTools: Set<string>;
	toggleTool: (id: string) => void;
	checkpoints: CheckpointMeta[];
	revertCheckpoint: (id: string) => void;
	handleSendMessage?: (text: string) => void;
	onMdFileClick?: (path: string) => void;
	slashCommandNames: readonly string[];
	stickToBottom: boolean;
}) {
	const didInitialScrollRef = useRef(false);
	const messageListRef = useRef<HTMLDivElement | null>(null);
	const renderRows = useMemo(
		() =>
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
				checkpoints: checkpoints.map(({ afterMessageId }) => ({
					afterMessageId,
				})),
			}),
		[messages, checkpoints],
	);
	const measuredHeights = useRef(new Map<string, number>());
	const [measurementVersion, setMeasurementVersion] = useState(0);
	const [scrollOffset, setScrollOffset] = useState<number | null>(null);
	const virtual = renderRows.length > 60;
	const offsets = useMemo(
		() =>
			rustProject<number[]>(
				"chatOffsets",
				renderRows.map((row) => measuredHeights.current.get(row.key) ?? null),
			),
		[renderRows, measurementVersion],
	);
	const {
		firstVisible,

		start: windowStart,
		end: windowEnd,
	} = useMemo(
		() =>
			rustProject<ChatWindow>("chatWindow", {
				offsets,
				scrollOffset,
				viewportHeight: scrollElementRef.current?.clientHeight ?? 800,
			}),
		[renderRows, offsets, scrollOffset, scrollElementRef],
	);
	useLayoutEffect(() => {
		const element = scrollElementRef.current;
		if (!element || !virtual) return;
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
		element.addEventListener("scroll", update, { passive: true });
		update();
		return () => {
			element.removeEventListener("scroll", update);
			if (frame) cancelAnimationFrame(frame);
		};
	}, [scrollElementRef, virtual]);
	useLayoutEffect(() => {
		const list = messageListRef.current;
		if (!list || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver((entries) => {
			let changed = false;
			let adjustment = 0;
			for (const entry of entries) {
				const element = entry.target as HTMLElement;
				const key = element.dataset.chatRowKey;
				const index = Number(element.dataset.chatRowIndex);
				if (!key) continue;
				const height = element.getBoundingClientRect().height;
				if (height <= 0) continue;
				const previous = measuredHeights.current.get(key) ?? 160;
				if (Math.abs(previous - height) < 0.5) continue;
				measuredHeights.current.set(key, height);
				if (index < firstVisible) adjustment += height - previous;
				changed = true;
			}
			if (changed) {
				if (adjustment && scrollElementRef.current && !stickToBottom)
					scrollElementRef.current.scrollTop += adjustment;
				setMeasurementVersion((version) => version + 1);
			}
		});
		for (const row of list.querySelectorAll(":scope > [data-chat-row-key]"))
			observer.observe(row);
		return () => observer.disconnect();
	}, [
		windowStart,
		windowEnd,
		firstVisible,
		renderRows,
		scrollElementRef,
		stickToBottom,
	]);
	useEffect(() => {
		const keys = new Set(renderRows.map((row) => row.key));
		for (const key of measuredHeights.current.keys())
			if (!keys.has(key)) measuredHeights.current.delete(key);
	}, [renderRows]);
	const pinToBottom = useCallback(
		(behavior: ScrollBehavior = "auto") => {
			const element = scrollElementRef.current;
			if (!element) return;
			if (behavior === "smooth") {
				element.scrollTo({ top: element.scrollHeight, behavior });
				return;
			}
			element.scrollTop = Math.max(
				0,
				element.scrollHeight - element.clientHeight,
			);
		},
		[scrollElementRef],
	);

	useImperativeHandle(
		virtualizerControlsRef,
		() => ({
			scrollToEnd: (behavior = "smooth") => {
				if (renderRows.length === 0) return;
				pinToBottom(behavior);
			},
			isAtEnd: () => {
				const el = scrollElementRef.current;
				if (!el) return true;
				return el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
			},
			getDistanceFromEnd: () => {
				const el = scrollElementRef.current;
				if (!el) return 0;
				return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
			},
		}),
		[pinToBottom, renderRows.length, scrollElementRef],
	);

	useLayoutEffect(() => {
		if (renderRows.length === 0) return;
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
		const scrollElement = scrollElementRef.current;
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
	}, [pinToBottom, renderRows.length, scrollElementRef]);

	useLayoutEffect(() => {
		const list = messageListRef.current;
		if (!list || !stickToBottom || typeof ResizeObserver === "undefined")
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
	}, [pinToBottom, stickToBottom]);

	useLayoutEffect(() => {
		if (renderRows.length > 0) return;
		didInitialScrollRef.current = false;
	}, [renderRows.length]);

	return (
		<div ref={messageListRef} {...stylex.props(styles.messageList)}>
			{virtual && (
				<div
					aria-hidden="true"
					style={inlineStyles.getChatMessageListDivStyle(offsets[windowStart])}
				/>
			)}
			{renderRows.slice(windowStart, windowEnd).map((item, windowIndex) => {
				const index = windowStart + windowIndex;
				return (
					<ChatRenderRow
						key={item.key}
						item={item}
						index={index}
						rowKey={item.key}
						paneId={paneId}
						expandedTools={expandedTools}
						toggleTool={toggleTool}
						messages={messages}
						checkpoint={
							item.checkpoint === null
								? undefined
								: checkpoints[item.checkpoint]
						}
						revertCheckpoint={revertCheckpoint}
						handleSendMessage={handleSendMessage}
						onMdFileClick={onMdFileClick}
						slashCommandNames={slashCommandNames}
					/>
				);
			})}
			{virtual && (
				<div
					aria-hidden="true"
					style={inlineStyles.getChatMessageListDivStyle1(
						offsets[renderRows.length]! - offsets[windowEnd]!,
					)}
				/>
			)}
		</div>
	);
});
