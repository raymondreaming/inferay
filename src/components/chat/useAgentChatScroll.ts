import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatVirtualizerControls } from "./ChatMessageList.tsx";

export function useAgentChatScroll(isSelected?: boolean) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const chatVirtualizerRef = useRef<ChatVirtualizerControls | null>(null);
	const [isAtBottom, setIsAtBottom] = useState(true);
	const autoFollowRef = useRef(true);
	const programmaticScrollRef = useRef(false);

	const handleScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const atBottom =
			chatVirtualizerRef.current?.isAtEnd() ??
			el.scrollHeight - el.scrollTop - el.clientHeight < 48;
		setIsAtBottom(atBottom);
		if (programmaticScrollRef.current) return;
		autoFollowRef.current = atBottom;
	}, []);

	const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
		const el = scrollRef.current;
		if (!el) return;
		autoFollowRef.current = true;
		programmaticScrollRef.current = true;
		if (chatVirtualizerRef.current) {
			chatVirtualizerRef.current.scrollToEnd(behavior);
		} else {
			el.scrollTo({ top: el.scrollHeight, behavior });
		}
		setIsAtBottom(true);
		window.setTimeout(
			() => {
				programmaticScrollRef.current = false;
			},
			behavior === "smooth" ? 260 : 0
		);
	}, []);

	const scrollChatByArrow = useCallback((direction: 1 | -1) => {
		const el = scrollRef.current;
		if (!el) return;
		autoFollowRef.current = false;
		programmaticScrollRef.current = true;
		const amount = Math.max(56, Math.round(el.clientHeight * 0.18));
		el.scrollBy({ top: direction * amount, behavior: "auto" });
		requestAnimationFrame(() => {
			const atBottom =
				chatVirtualizerRef.current?.isAtEnd() ??
				el.scrollHeight - el.scrollTop - el.clientHeight < 48;
			setIsAtBottom(atBottom);
			autoFollowRef.current = atBottom;
			programmaticScrollRef.current = false;
		});
	}, []);

	const handleVirtualizerReady = useCallback(
		(controls: ChatVirtualizerControls | null) => {
			chatVirtualizerRef.current = controls;
			if (controls) setIsAtBottom(controls.isAtEnd());
		},
		[]
	);

	useEffect(() => {
		if (!isSelected) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "ArrowDown") return;
			const active = document.activeElement;
			if (
				active &&
				(active.tagName === "TEXTAREA" || active.tagName === "INPUT")
			) {
				return;
			}
			if (!isAtBottom) {
				e.preventDefault();
				scrollToBottom();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [isSelected, isAtBottom, scrollToBottom]);

	return {
		scrollRef,
		chatVirtualizerRef,
		isAtBottom,
		autoFollowRef,
		handleScroll,
		scrollToBottom,
		scrollChatByArrow,
		handleVirtualizerReady,
	};
}
