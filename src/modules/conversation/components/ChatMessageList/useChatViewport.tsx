import type { ChatScrollSnapshot, ChatScrollState } from "@contracts";
import {
	CHAT_SCROLL_KEY_PREFIX,
	ChatViewportRetention,
	project,
	readStoredJson,
	writeStoredJson,
} from "@shared/lib/native.tsx";
import {
	type Accessor,
	createEffect,
	createSignal,
	onSettled,
	untrack,
} from "solid-js";
export type ChatVirtualizerControls = {
	scrollToEnd: (behavior?: ScrollBehavior) => void;
};
type ChatViewportState = {
	snapshot: ChatScrollSnapshot;
	heights: Map<string, number>;
	width: number | null;
};
const viewportRetention = new ChatViewportRetention(16);
const retainedViewports = new Map<string, ChatViewportState>();
export const chatViewportState = (paneId: string) => {
	const state = retainedViewports.get(paneId) ?? {
		snapshot: readStoredJson<ChatScrollSnapshot>(
			CHAT_SCROLL_KEY_PREFIX + paneId,
			{
				following: true,
				top: 0,
			},
		),
		heights: new Map<string, number>(),
		width: null,
	};
	retainedViewports.set(paneId, state);
	for (const evicted of JSON.parse(viewportRetention.touch(paneId)) as string[])
		retainedViewports.delete(evicted);
	return state;
};

export function useChatViewport(
	_isVisible: Accessor<boolean> = () => true,
	_paneId: Accessor<string> = () => "",
	_transcriptReady: Accessor<boolean> = () => true,
) {
	const retainedViewport = untrack(() => chatViewportState(_paneId()));
	const storageKey = CHAT_SCROLL_KEY_PREFIX + untrack(_paneId);
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
	const restoreFrameRef = { current: 0 };
	let restoring = false;
	let pointerScrolling = false;
	// Event handlers use native intent immediately, before Solid publishes it.
	let state: ChatScrollState = {
		snapshot: retainedViewport.snapshot,
		cancelRestore: false,
	};
	const [following, publishFollowing] = createSignal(state.snapshot.following);
	const update = (action: string, input: Record<string, unknown> = {}) => {
		const wasFollowing = state.snapshot.following;
		state = project<ChatScrollState>("chatScrollState", {
			state,
			action,
			...input,
		});
		retainedViewport.snapshot = state.snapshot;
		publishFollowing(state.snapshot.following);
		if (state.cancelRestore) cancelScrollRestore();
		if (state.snapshot.following !== wasFollowing)
			writeStoredJson(storageKey, state.snapshot);
	};
	const handleScroll = () => {
		const element = scrollRef.current;
		if (!_isVisible() || !_transcriptReady() || restoring || !element) return;
		update("scroll", {
			top: element.scrollTop,
			viewport: element.clientHeight,
			pointer: pointerScrolling,
		});
	};
	const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
		cancelScrollRestore();
		update("follow");
		const el = scrollRef.current;
		if (!_isVisible() || !el || el.clientHeight === 0) return;
		if (chatVirtualizerRef.current)
			chatVirtualizerRef.current.scrollToEnd(behavior);
		else
			el.scrollTo({
				top: el.scrollHeight,
				behavior,
			});
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
				if (_isVisible() && state.snapshot.following) scrollToBottom(behavior);
			});
		});
	};
	const cancelScrollRestore = () => {
		cancelScheduledBottom();
		cancelAnimationFrame(restoreFrameRef.current);
		restoreFrameRef.current = 0;
		restoring = false;
	};
	createEffect(
		() => [_isVisible(), scrollElement(), _transcriptReady()] as const,
		([visible, element, ready]) => {
			if (!visible || !element || !ready) {
				cancelScrollRestore();
				return;
			}
			const snapshot = state.snapshot;
			restoring = true;
			let passes = 3;
			const restore = () => {
				restoreFrameRef.current = 0;
				if (!restoring || !_isVisible()) return;
				const el = element;
				if (el.clientHeight === 0) return;
				el.scrollTop = project<number>("chatScrollRestore", {
					snapshot,
					height: el.scrollHeight,
					viewport: el.clientHeight,
				});
				if (--passes) restoreFrameRef.current = requestAnimationFrame(restore);
				else {
					restoring = false;
					observer.disconnect();
					handleScroll();
				}
			};
			// A revealed pane may still have zero height until its parent lays out.
			const observer = new ResizeObserver(() => {
				if (restoring && !restoreFrameRef.current)
					restoreFrameRef.current = requestAnimationFrame(restore);
			});
			observer.observe(element);
			restoreFrameRef.current = requestAnimationFrame(restore);
			return () => {
				observer.disconnect();
				cancelScrollRestore();
				// Hidden DOM can already report zero dimensions here. Save the last
				// visible position instead of treating layout changes as user scrolls.
				writeStoredJson(storageKey, state.snapshot);
			};
		},
	);
	createEffect(
		() => (_isVisible() ? scrollElement() : null),
		(element) => {
			if (!element) return;
			const keyDown = (event: KeyboardEvent) => {
				const target = event.target as HTMLElement;
				if (
					event.defaultPrevented ||
					target.closest("input, textarea, select, [contenteditable='true']") ||
					(event.key === " " && target.closest("button, a"))
				)
					return;
				update("intent", { key: event.key, shift: event.shiftKey });
			};
			const wheel = (event: WheelEvent) =>
				update("intent", { delta: event.deltaY });
			let touchY = 0;
			const touchStart = (event: TouchEvent) => {
				touchY = event.touches[0]?.clientY ?? 0;
			};
			const touchMove = (event: TouchEvent) => {
				const next = event.touches[0]?.clientY ?? touchY;
				update("intent", { delta: touchY - next });
				touchY = next;
			};
			const pointerDown = () => {
				pointerScrolling = true;
				cancelScrollRestore();
			};
			const pointerUp = () => {
				pointerScrolling = false;
			};
			element.addEventListener("keydown", keyDown);
			element.addEventListener("wheel", wheel, {
				passive: true,
				capture: true,
			});
			element.addEventListener("touchstart", touchStart, { passive: true });
			element.addEventListener("touchmove", touchMove, { passive: true });
			element.addEventListener("pointerdown", pointerDown, { passive: true });
			window.addEventListener("pointerup", pointerUp);
			window.addEventListener("pointercancel", pointerUp);
			return () => {
				element.removeEventListener("keydown", keyDown);
				element.removeEventListener("wheel", wheel, true);
				element.removeEventListener("touchstart", touchStart);
				element.removeEventListener("touchmove", touchMove);
				element.removeEventListener("pointerdown", pointerDown);
				window.removeEventListener("pointerup", pointerUp);
				window.removeEventListener("pointercancel", pointerUp);
				pointerScrolling = false;
			};
		},
	);
	return {
		chatVirtualizerRef,
		handleScroll,
		highlightOverlayRef,
		get following() {
			return following();
		},
		scheduleScrollToBottom,
		scrollRef,
		scrollToBottom,
		textareaRef,
	};
}
