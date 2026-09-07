import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "octane";
import { listenWindowEvent } from "../../../../shared/lib/data.ts";
import type { ChatVirtualizerControls } from "./index.tsx";

export function useChatViewport(
	input: string,
	isSelected?: boolean,
	isVisible = true,
) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const chatVirtualizerRef = useRef<ChatVirtualizerControls | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const highlightOverlayRef = useRef<HTMLDivElement | null>(null);
	const scrollSnapshotRef = useRef({ atBottom: true, fromBottom: 0, top: 0 });
	const restoreFrameRef = useRef(0);
	const [isAtBottom, setIsAtBottom] = useState(true);
	const handleScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		setIsAtBottom(
			chatVirtualizerRef.current?.isAtEnd() ??
				el.scrollHeight - el.scrollTop - el.clientHeight < 48,
		);
	}, []);
	const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
		const el = scrollRef.current;
		if (!el) return;
		if (chatVirtualizerRef.current)
			chatVirtualizerRef.current.scrollToEnd(behavior);
		else el.scrollTo({ top: el.scrollHeight, behavior });
		setIsAtBottom(true);
	}, []);
	const scheduleScrollToBottom = useCallback(
		(behavior: ScrollBehavior = "auto") => {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => scrollToBottom(behavior));
			});
		},
		[scrollToBottom],
	);
	const cancelScrollRestore = useCallback(() => {
		cancelAnimationFrame(restoreFrameRef.current);
		restoreFrameRef.current = 0;
	}, []);
	useLayoutEffect(() => {
		if (!isVisible) return;
		const snapshot = scrollSnapshotRef.current;
		let passes = 3;
		const restore = () => {
			const el = scrollRef.current;
			if (!el) return;
			const max = Math.max(0, el.scrollHeight - el.clientHeight);
			el.scrollTop = snapshot.atBottom
				? Math.max(0, max - snapshot.fromBottom)
				: Math.min(snapshot.top, max);
			setIsAtBottom(snapshot.atBottom);
			if (--passes) restoreFrameRef.current = requestAnimationFrame(restore);
		};
		restore();
		return () => {
			cancelScrollRestore();
			const el = scrollRef.current;
			if (!el) return;
			const fromBottom = Math.max(
				0,
				el.scrollHeight - el.scrollTop - el.clientHeight,
			);
			scrollSnapshotRef.current = {
				atBottom: fromBottom < 48,
				fromBottom,
				top: el.scrollTop,
			};
		};
	}, [cancelScrollRestore, isVisible]);
	useEffect(() => {
		if (!isVisible) return;
		const ta = textareaRef.current;
		if (!ta) return;
		if (!input) {
			ta.style.height = "20px";
		} else {
			ta.style.height = "20px";
			ta.style.height = `${Math.min(Math.max(ta.scrollHeight, 20), 120)}px`;
		}
		if (highlightOverlayRef.current) {
			highlightOverlayRef.current.style.transform = `translateY(-${ta.scrollTop}px)`;
		}
	}, [input, isVisible]);
	const handleWindowKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key !== "ArrowDown") return;
			const active = document.activeElement;
			if (
				active &&
				(active.tagName === "TEXTAREA" || active.tagName === "INPUT")
			)
				return;
			if (!isAtBottom) {
				e.preventDefault();
				scrollToBottom();
			}
		},
		[isAtBottom, scrollToBottom],
	);
	useEffect(() => {
		if (!isSelected || !isVisible) return;
		return listenWindowEvent("keydown", handleWindowKeyDown);
	}, [handleWindowKeyDown, isSelected, isVisible]);
	return {
		chatVirtualizerRef,
		cancelScrollRestore,
		handleScroll,
		highlightOverlayRef,
		isAtBottom,
		scheduleScrollToBottom,
		scrollRef,
		scrollToBottom,
		textareaRef,
	};
}
