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
	buildRenderItems,
	type RenderItem,
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

type ChatRenderRow = RenderItem & { continuesAfter?: boolean };

function getRowKey(row: ChatRenderRow | undefined, index: number) {
	if (!row) return `row-${index}`;
	if (row.type === "edit-group") {
		return `edit-group:${row.edits[0]?.render?.groupId ?? row.edits[0]?.id}`;
	}
	if (row.type === "tool-group") {
		return `tool-group:${row.tools[0]?.id}`;
	}
	return row.message.id;
}

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
	const renderItems = useMemo(() => buildRenderItems(messages), [messages]);
	// Timeline groups are semantic units, but each milestone is a measured row
	// so one long run of tools cannot defeat transcript virtualization.
	const renderRows = useMemo<ChatRenderRow[]>(
		() =>
			renderItems.flatMap<ChatRenderRow>((item) =>
				item.type === "tool-group"
					? item.tools.map((tool, index) => ({
							type: "tool-group" as const,
							tools: [tool],
							continuesAfter: index < item.tools.length - 1,
						}))
					: [item],
			),
		[renderItems],
	);
	const measuredHeights = useRef(new Map<string, number>());
	const [measurementVersion, setMeasurementVersion] = useState(0);
	const [scrollOffset, setScrollOffset] = useState<number | null>(null);
	const virtual = renderRows.length > 60;
	const rowOffsets = useMemo(() => {
		const offsets = [0];
		for (let index = 0; index < renderRows.length; index++) {
			offsets.push(
				offsets[index]! +
					(measuredHeights.current.get(getRowKey(renderRows[index]!, index)) ??
						160),
			);
		}
		return offsets;
	}, [renderRows, measurementVersion]);
	let firstVisible = 0;
	if (virtual) {
		if (scrollOffset === null)
			firstVisible = Math.max(0, renderRows.length - 24);
		else {
			let low = 0;
			let high = renderRows.length;
			while (low < high) {
				const middle = (low + high) >>> 1;
				if (rowOffsets[middle + 1]! <= scrollOffset) low = middle + 1;
				else high = middle;
			}
			firstVisible = Math.min(low, renderRows.length - 1);
		}
	}
	const windowStart = virtual ? Math.max(0, firstVisible - 8) : 0;
	let windowEnd = renderRows.length;
	if (virtual) {
		const viewportBottom =
			(scrollOffset ?? rowOffsets[firstVisible]!) +
			(scrollElementRef.current?.clientHeight || 800);
		let low = firstVisible;
		let high = renderRows.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (rowOffsets[middle]! < viewportBottom) low = middle + 1;
			else high = middle;
		}
		windowEnd = Math.min(
			renderRows.length,
			Math.max(windowStart + 48, low + 8),
		);
	}
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
		const keys = new Set(renderRows.map(getRowKey));
		for (const key of measuredHeights.current.keys())
			if (!keys.has(key)) measuredHeights.current.delete(key);
	}, [renderRows]);
	const checkpointsByMessageId = useMemo(() => {
		const byMessageId = new Map<string, CheckpointInfo>();
		for (const checkpoint of checkpoints) {
			if (checkpoint.afterMessageId) {
				byMessageId.set(checkpoint.afterMessageId, checkpoint);
			}
		}
		return byMessageId;
	}, [checkpoints]);
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
							key={getRowKey(item, index)}
							data-chat-row-key={getRowKey(item, index)}
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
							key={getRowKey(item, index)}
							data-chat-row-key={getRowKey(item, index)}
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
						key={getRowKey(item, index)}
						data-chat-row-key={getRowKey(item, index)}
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
