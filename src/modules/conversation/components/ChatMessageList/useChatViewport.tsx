import { type Accessor, createEffect, createSignal, onSettled } from "solid-js";
import { listenWindowEvent } from "../../../../shared/lib/dom.tsx";
import type { ChatVirtualizerControls } from "./index.tsx";
export function useChatViewport(
	_input: Accessor<string>,
	_isSelected: Accessor<boolean | undefined> = () => undefined,
	_isVisible: Accessor<boolean> = () => true,
) {
	const scrollRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const chatVirtualizerRef = {
		current: null,
	} as {
		current: ChatVirtualizerControls | null;
	};
	const textareaRef = {
		current: null,
	} as {
		current: HTMLTextAreaElement | null;
	};
	const highlightOverlayRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const scrollSnapshotRef = {
		current: {
			atBottom: true,
			fromBottom: 0,
			top: 0,
		},
	};
	const restoreFrameRef = {
		current: 0,
	};
	const [isAtBottom, setIsAtBottom] = createSignal(true);
	const handleScroll = () => {
		const el = scrollRef.current;
		if (!el) return;
		setIsAtBottom(
			chatVirtualizerRef.current?.isAtEnd() ??
				el.scrollHeight - el.scrollTop - el.clientHeight < 48,
		);
	};
	const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
		const el = scrollRef.current;
		if (!el) return;
		if (chatVirtualizerRef.current)
			chatVirtualizerRef.current.scrollToEnd(behavior);
		else
			el.scrollTo({
				top: el.scrollHeight,
				behavior,
			});
		setIsAtBottom(true);
	};
	let bottomFrame = 0;
	const cancelScheduledBottom = () => {
		cancelAnimationFrame(bottomFrame);
		bottomFrame = 0;
	};
	onSettled(() => cancelScheduledBottom);
	const scheduleScrollToBottom = (behavior: ScrollBehavior = "auto") => {
		cancelScheduledBottom();
		bottomFrame = requestAnimationFrame(() => {
			bottomFrame = requestAnimationFrame(() => {
				bottomFrame = 0;
				if (_isVisible()) scrollToBottom(behavior);
			});
		});
	};
	const cancelScrollRestore = () => {
		cancelScheduledBottom();
		cancelAnimationFrame(restoreFrameRef.current);
		restoreFrameRef.current = 0;
	};
	createEffect(
		() => _isVisible(),
		(visible) => {
			if (!visible) {
				cancelScheduledBottom();
				return;
			}
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
		},
	);
	createEffect(
		() => [_input(), _isVisible()] as const,
		([input, visible]) => {
			if (!visible) return;
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
		},
	);
	const handleWindowKeyDown = (e: KeyboardEvent) => {
		if (e.key !== "ArrowDown") return;
		const active = document.activeElement;
		if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT"))
			return;
		if (!isAtBottom()) {
			e.preventDefault();
			scrollToBottom();
		}
	};
	createEffect(
		() => !!_isSelected() && _isVisible(),
		(enabled) => {
			if (!enabled) return;
			return listenWindowEvent("keydown", handleWindowKeyDown);
		},
	);
	return {
		get chatVirtualizerRef() {
			return chatVirtualizerRef;
		},
		get cancelScrollRestore() {
			return cancelScrollRestore;
		},
		get handleScroll() {
			return handleScroll;
		},
		get highlightOverlayRef() {
			return highlightOverlayRef;
		},
		get isAtBottom() {
			return isAtBottom();
		},
		get scheduleScrollToBottom() {
			return scheduleScrollToBottom;
		},
		get scrollRef() {
			return scrollRef;
		},
		get scrollToBottom() {
			return scrollToBottom;
		},
		get textareaRef() {
			return textareaRef;
		},
	};
}
