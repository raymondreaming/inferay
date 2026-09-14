import type { ChatScrollState } from "@contracts";
import { listenWindowEvent } from "@shared/lib/dom.tsx";
import { project } from "@shared/lib/native.tsx";
import {
	type Accessor,
	createEffect,
	createSignal,
	onSettled,
	untrack,
} from "solid-js";
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
	const restoreFrameRef = { current: 0 };
	// Event handlers use native intent immediately, before Solid publishes it.
	let state: ChatScrollState = {
		snapshot: retainedViewport.snapshot,
		towardBottom: false,
		cancelRestore: false,
	};
	const [isAtBottom, publishFollowing] = createSignal(state.snapshot.atBottom);
	const update = (action: string, input: Record<string, unknown> = {}) => {
		state = project<ChatScrollState>("chatScrollState", {
			state,
			action,
			...input,
		});
		retainedViewport.snapshot = state.snapshot;
		publishFollowing(state.snapshot.atBottom);
		if (state.cancelRestore) cancelScrollRestore();
	};
	const capture = (element: HTMLDivElement, action = "capture") =>
		update(action, {
			top: element.scrollTop,
			height: element.scrollHeight,
			viewport: element.clientHeight,
		});
	const handleScroll = () => {
		if (scrollRef.current) capture(scrollRef.current, "scroll");
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
		update("follow");
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
			const snapshot = state.snapshot;
			let passes = 3;
			const restore = () => {
				const el = element;
				if (el.clientHeight === 0) return;
				el.scrollTop = project<number>("chatScrollRestore", {
					snapshot,
					height: el.scrollHeight,
					viewport: el.clientHeight,
				});
				update("follow", { value: snapshot.atBottom });
				if (--passes) restoreFrameRef.current = requestAnimationFrame(restore);
			};
			restore();
			return () => {
				cancelScrollRestore();
				capture(element);
			};
		},
	);
	createEffect(
		() => scrollElement(),
		(element) => {
			if (!element) return;
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
			element.addEventListener("wheel", wheel, {
				passive: true,
				capture: true,
			});
			element.addEventListener("touchstart", touchStart, { passive: true });
			element.addEventListener("touchmove", touchMove, { passive: true });
			return () => {
				element.removeEventListener("wheel", wheel, true);
				element.removeEventListener("touchstart", touchStart);
				element.removeEventListener("touchmove", touchMove);
			};
		},
	);
	const handleWindowKeyDown = (e: KeyboardEvent) => {
		const active = document.activeElement;
		if (
			e.defaultPrevented ||
			!active ||
			!scrollRef.current?.contains(active) ||
			active.closest(
				"input, textarea, select, button, a, [contenteditable='true']",
			)
		)
			return;
		update("intent", { key: e.key, shift: e.shiftKey });
	};
	createEffect(
		() => !!_isSelected() && _isVisible(),
		(enabled) => {
			if (!enabled) return;
			return listenWindowEvent("keydown", handleWindowKeyDown);
		},
	);
	return {
		chatVirtualizerRef,
		cancelScrollRestore,
		handleScroll,
		highlightOverlayRef,
		get isAtBottom() {
			return isAtBottom();
		},
		scheduleScrollToBottom,
		scrollRef,
		scrollToBottom,
		textareaRef,
	};
}
