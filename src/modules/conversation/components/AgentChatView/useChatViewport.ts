import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "octane";

import { listenWindowEvent } from "../../../../shared/lib/react-events.ts";

import type { ChatVirtualizerControls } from "../ChatMessageList/index.tsx";

export function useChatViewport(
	input: string,
	isSelected?: boolean,
	isVisible = true,
) {
	type ScrollSnapshot = {
		atBottom: boolean;
		fromBottom: number;
		top: number;
	};
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const chatVirtualizerRef = useRef<ChatVirtualizerControls | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const highlightOverlayRef = useRef<HTMLDivElement | null>(null);
	const wasSelectedRef = useRef(isSelected);
	const activationRestoreFrameRef = useRef(0);
	const scrollSnapshotRef = useRef<ScrollSnapshot>({
		atBottom: true,
		fromBottom: 0,
		top: 0,
	});
	const [isAtBottom, setIsAtBottom] = useState(true);
	const captureScrollSnapshot = useCallback(() => {
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
	}, []);
	const handleScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const nextIsAtBottom =
			chatVirtualizerRef.current?.isAtEnd() ??
			el.scrollHeight - el.scrollTop - el.clientHeight < 48;
		setIsAtBottom(nextIsAtBottom);
		if (!isSelected) captureScrollSnapshot();
	}, [captureScrollSnapshot, isSelected]);
	const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
		const el = scrollRef.current;
		if (!el) return;
		if (chatVirtualizerRef.current) {
			chatVirtualizerRef.current.scrollToEnd(behavior);
		} else {
			el.scrollTo({ top: el.scrollHeight, behavior });
		}
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
	useLayoutEffect(() => {
		const wasSelected = wasSelectedRef.current;
		wasSelectedRef.current = isSelected;
		if (wasSelected && !isSelected) {
			captureScrollSnapshot();
			return;
		}
		if (wasSelected || !isSelected || !isVisible) return;
		const el = scrollRef.current;
		if (!el) return;
		const snapshot = scrollSnapshotRef.current;
		let passes = 6;
		const restoreViewport = () => {
			const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
			el.scrollTop = snapshot.atBottom
				? Math.max(0, maxScrollTop - snapshot.fromBottom)
				: Math.min(snapshot.top, maxScrollTop);
			setIsAtBottom(snapshot.atBottom);
			passes -= 1;
			if (passes > 0) {
				activationRestoreFrameRef.current =
					requestAnimationFrame(restoreViewport);
			} else {
				activationRestoreFrameRef.current = 0;
			}
		};
		restoreViewport();
		return () => {
			if (activationRestoreFrameRef.current) {
				cancelAnimationFrame(activationRestoreFrameRef.current);
				activationRestoreFrameRef.current = 0;
			}
		};
	}, [captureScrollSnapshot, isSelected, isVisible]);
	const cancelActivationRestore = useCallback(() => {
		if (!activationRestoreFrameRef.current) return;
		cancelAnimationFrame(activationRestoreFrameRef.current);
		activationRestoreFrameRef.current = 0;
	}, []);
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
		handleScroll,
		highlightOverlayRef,
		isAtBottom,
		cancelActivationRestore,
		scheduleScrollToBottom,
		scrollRef,
		scrollToBottom,
		textareaRef,
	};
}
