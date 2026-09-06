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
import type {
	ChatMessage,
	CheckpointInfo,
} from "../../model/agent-chat-shared.ts";
import {
	buildRenderRows,
	calculateChatOffsets,
	calculateChatWindow,
	getRenderRowKey,
	indexCheckpoints,
} from "../../model/agent-chat-shared.ts";
import { GroupedEditDiff } from "../ChatEditDiff/index.tsx";
import { Bubble } from "./Bubble.tsx";
import { CheckpointMarker } from "./CheckpointMarker.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
import { ToolTimeline } from "./ToolTimeline.tsx";

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
	checkpoints: CheckpointInfo[];
	revertCheckpoint: (id: string) => void;
	handleSendMessage?: (text: string) => void;
	onMdFileClick?: (path: string) => void;
	slashCommandNames: readonly string[];
	stickToBottom: boolean;
}) {
	const didInitialScrollRef = useRef(false);
	const messageListRef = useRef<HTMLDivElement | null>(null);
	const renderRows = useMemo(() => buildRenderRows(messages), [messages]);
	const measuredHeights = useRef(new Map<string, number>());
	const [measurementVersion, setMeasurementVersion] = useState(0);
	const [scrollOffset, setScrollOffset] = useState<number | null>(null);
	const virtual = renderRows.length > 60;
	const offsets = useMemo(
		() => calculateChatOffsets(renderRows, measuredHeights.current),
		[renderRows, measurementVersion],
	);
	const {
		firstVisible,
		offsets: rowOffsets,
		start: windowStart,
		end: windowEnd,
	} = useMemo(
		() =>
			calculateChatWindow(
				renderRows,
				offsets,
				scrollOffset,
				scrollElementRef.current?.clientHeight ?? 800,
			),
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
		const keys = new Set(renderRows.map(getRenderRowKey));
		for (const key of measuredHeights.current.keys())
			if (!keys.has(key)) measuredHeights.current.delete(key);
	}, [renderRows]);
	const checkpointsByMessageId = useMemo(
		() => indexCheckpoints(checkpoints),
		[checkpoints],
	);
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
					style={inlineStyles.getChatMessageListDivStyle(
						rowOffsets[windowStart],
					)}
				/>
			)}
			{renderRows.slice(windowStart, windowEnd).map((item, windowIndex) => {
				const index = windowStart + windowIndex;
				if (item.type === "edit-group") {
					return (
						<div
							key={getRenderRowKey(item, index)}
							data-chat-row-key={getRenderRowKey(item, index)}
							data-chat-row-index={index}
							{...stylex.props(styles.messageRow)}
						>
							<GroupedEditDiff filePath={item.filePath} edits={item.edits} />
						</div>
					);
				}
				if (item.type === "tool-group") {
					return (
						<div
							key={getRenderRowKey(item, index)}
							data-chat-row-key={getRenderRowKey(item, index)}
							data-chat-row-index={index}
							{...stylex.props(
								styles.messageRow,
								item.continuesAfter && styles.continuingToolRow,
							)}
						>
							<ToolTimeline
								tools={item.tools}
								continuesAfter={item.continuesAfter}
								expandedTools={expandedTools}
								onToggle={toggleTool}
							/>
						</div>
					);
				}
				const msg = item.message;
				const checkpoint =
					msg.role === "assistant" && !msg.isStreaming
						? checkpointsByMessageId.get(msg.id)
						: undefined;
				return (
					<div
						key={getRenderRowKey(item, index)}
						data-chat-row-key={getRenderRowKey(item, index)}
						data-chat-row-index={index}
						{...stylex.props(styles.messageRow)}
					>
						<Bubble
							paneId={paneId}
							msg={msg}
							collapsed={!expandedTools.has(msg.id)}
							onToggle={toggleTool}
							onSendMessage={handleSendMessage}
							onMdFileClick={onMdFileClick}
							slashCommandNames={slashCommandNames}
						/>
						{checkpoint && (
							<CheckpointMarker
								checkpoint={checkpoint}
								onRevert={revertCheckpoint}
							/>
						)}
					</div>
				);
			})}
			{virtual && (
				<div
					aria-hidden="true"
					style={inlineStyles.getChatMessageListDivStyle1(
						rowOffsets[renderRows.length]! - rowOffsets[windowEnd]!,
					)}
				/>
			)}
		</div>
	);
});
