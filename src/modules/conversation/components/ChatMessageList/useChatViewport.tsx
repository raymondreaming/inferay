import {
	type Accessor,
	createEffect,
	createSignal,
	onSettled,
	untrack,
} from "solid-js";
import { listenWindowEvent } from "../../../../shared/lib/dom.tsx";
import { chatViewportState } from "./chatViewportCache.ts";
import type { ChatVirtualizerControls } from "./index.tsx";

export function useChatViewport(
	_isSelected: Accessor<boolean | undefined> = () => undefined,
	_isVisible: Accessor<boolean> = () => true,
	_paneId: Accessor<string> = () => "",
) {
	const retainedViewport = untrack(() => chatViewportState(_paneId()));
	const [scrollElement, setScrollElement] = createSignal<HTMLDivElement | null>(
		null,
	);
	const scrollRef = {
		get current() {
			return scrollElement();
		},
		set current(element: HTMLDivElement | null) {
			setScrollElement(element);
		},
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
		current: retainedViewport.snapshot,
	};
	const restoreFrameRef = {
		current: 0,
	};
	// Event handlers need the latest intent even before Solid commits signal writes.
	let following = retainedViewport.snapshot.atBottom;
	const [isAtBottom, publishFollowing] = createSignal(following);
	const setFollowing = (value: boolean) => {
		following = value;
		publishFollowing(value);
	};
	const handleScroll = () => {
		const el = scrollRef.current;
		if (!el || el.clientHeight === 0) return;
		const fromBottom = Math.max(
			0,
			el.scrollHeight - el.scrollTop - el.clientHeight,
		);
		// Content growth can emit scroll events without a user's scroll. Keep
		// following until the viewport actually moves up or the user asks to.
		const movement = el.scrollTop - scrollSnapshotRef.current.top;
		if (fromBottom <= 1) setFollowing(true);
		else if (movement < -1) setFollowing(false);
		else if (fromBottom <= 80 && movement > 1) setFollowing(true);
		retainedViewport.snapshot = scrollSnapshotRef.current = {
			atBottom: following,
			fromBottom,
			top: el.scrollTop,
		};
	};
	const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
		const el = scrollRef.current;
		if (!el || el.clientHeight === 0) return;
		if (chatVirtualizerRef.current)
			chatVirtualizerRef.current.scrollToEnd(behavior);
		else
			el.scrollTo({
				top: el.scrollHeight,
				behavior,
			});
		setFollowing(true);
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
		() => [_isVisible(), scrollElement()] as const,
		([visible, element]) => {
			if (!visible || !element) {
				cancelScheduledBottom();
				return;
			}
			const snapshot = scrollSnapshotRef.current;
			let passes = 3;
			const restore = () => {
				const el = element;
				if (el.clientHeight === 0) return;
				const max = Math.max(0, el.scrollHeight - el.clientHeight);
				el.scrollTop = snapshot.atBottom ? max : Math.min(snapshot.top, max);
				setFollowing(snapshot.atBottom);
				if (--passes) restoreFrameRef.current = requestAnimationFrame(restore);
			};
			restore();
			return () => {
				cancelScrollRestore();
				const el = element;
				if (!el || el.clientHeight === 0) return;
				const fromBottom = Math.max(
					0,
					el.scrollHeight - el.scrollTop - el.clientHeight,
				);
				retainedViewport.snapshot = scrollSnapshotRef.current = {
					atBottom: following,
					fromBottom,
					top: el.scrollTop,
				};
			};
		},
	);
	createEffect(
		() => scrollElement(),
		(element) => {
			if (!element) return;
			const stopFollowing = () => {
				cancelScrollRestore();
				setFollowing(false);
			};
			const wheel = (event: WheelEvent) => {
				if (event.deltaY < 0) stopFollowing();
			};
			let touchY = 0;
			const touchStart = (event: TouchEvent) => {
				touchY = event.touches[0]?.clientY ?? 0;
			};
			const touchMove = (event: TouchEvent) => {
				const next = event.touches[0]?.clientY ?? touchY;
				if (next > touchY) stopFollowing();
				touchY = next;
			};
			element.addEventListener("wheel", wheel, { passive: true });
			element.addEventListener("touchstart", touchStart, { passive: true });
			element.addEventListener("touchmove", touchMove, { passive: true });
			return () => {
				element.removeEventListener("wheel", wheel);
				element.removeEventListener("touchstart", touchStart);
				element.removeEventListener("touchmove", touchMove);
			};
		},
	);
	const handleWindowKeyDown = (e: KeyboardEvent) => {
		if (e.key !== "ArrowDown") return;
		const active = document.activeElement;
		if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT"))
			return;
		if (!following) {
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
