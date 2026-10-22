import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as signals from "@solidjs/signals";
import {
	CHAT_SCROLL_KEY_PREFIX,
	ChatViewportRetention,
	project,
} from "../../src/shared/lib/native.tsx";

function setup() {
	const source = readFileSync(
		new URL(
			"../../src/modules/conversation/components/ChatMessageList/useChatViewport.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const code = new Bun.Transpiler({ loader: "ts" })
		.transformSync(
			source.slice(source.indexOf("export type ChatVirtualizerControls")),
		)
		.replaceAll("export ", "");
	const stored = new Map<string, unknown>();
	const frames = new Map<number, FrameRequestCallback>();
	const observers = new Set<() => void>();
	const window = new EventTarget();
	let nextFrame = 0;
	const dependencies = {
		...signals,
		CHAT_SCROLL_KEY_PREFIX,
		ChatViewportRetention,
		project,
		window,
		readStoredJson: (key: string, fallback: unknown) =>
			stored.get(key) ?? fallback,
		writeStoredJson: (key: string, value: unknown) =>
			stored.set(key, structuredClone(value)),
		requestAnimationFrame: (callback: FrameRequestCallback) => {
			frames.set(++nextFrame, callback);
			return nextFrame;
		},
		cancelAnimationFrame: (id: number) => frames.delete(id),
		ResizeObserver: class {
			constructor(private callback: () => void) {}
			observe() {
				observers.add(this.callback);
			}
			disconnect() {
				observers.delete(this.callback);
			}
		},
	};
	const module = new Function(
		...Object.keys(dependencies),
		`${code}; return { useChatViewport, chatViewportState };`,
	)(...Object.values(dependencies)) as {
		useChatViewport: typeof import("../../src/modules/conversation/components/ChatMessageList/useChatViewport.tsx").useChatViewport;
		chatViewportState: (id: string) => unknown;
	};
	const frame = () => {
		signals.flush();
		const queued = [...frames];
		frames.clear();
		for (const [, callback] of queued) callback(0);
		signals.flush();
	};
	const settle = () => {
		for (let i = 0; i < 4; i++) frame();
	};
	const mount = (paneId = "one", initiallyReady = true) => {
		const element = Object.assign(new EventTarget(), {
			closest: (_selector: string): unknown => null,
			scrollTop: 0,
			clientHeight: 300,
			scrollHeight: 3000,
			scrollTo({ top }: ScrollToOptions) {
				this.scrollTop = Math.min(
					top ?? 0,
					this.scrollHeight - this.clientHeight,
				);
			},
		});
		const instance = signals.createRoot((dispose) => {
			const [visible, setVisible] = signals.createSignal(true);
			const [ready, setReady] = signals.createSignal(initiallyReady);
			const viewport = module.useChatViewport(visible, () => paneId, ready);
			viewport.scrollRef.current = element as unknown as HTMLDivElement;
			return { dispose, viewport, setVisible, setReady };
		});
		const scroll = (top: number) => {
			element.scrollTop = top;
			instance.viewport.handleScroll();
			signals.flush();
		};
		return {
			...instance,
			element,
			scroll,
			wheel: (deltaY: number) =>
				element.dispatchEvent(Object.assign(new Event("wheel"), { deltaY })),
		};
	};
	return {
		chatViewportState: module.chatViewportState,
		mount,
		settle,
		window,
		resize: () => {
			for (const observer of observers) observer();
		},
	};
}

test("follow mode survives tab switches; scrolling up stays paused until the arrow is pressed", () => {
	const fixture = setup();
	const chat = fixture.mount();
	try {
		fixture.settle();
		expect(chat.element.scrollTop).toBe(2700);
		chat.wheel(-100);
		chat.scroll(600);
		expect(chat.viewport.following).toBe(false);
		chat.setVisible(false);
		chat.element.clientHeight = 0;
		chat.scroll(0);
		fixture.settle();
		chat.element.clientHeight = 300;
		chat.element.scrollHeight = 5000;
		chat.setVisible(true);
		// A delayed browser scroll arrives before restoration has run.
		signals.flush();
		chat.scroll(0);
		fixture.settle();
		expect(chat.element.scrollTop).toBe(600);
		expect(chat.viewport.following).toBe(false);
		chat.wheel(100);
		chat.scroll(4700);
		expect(chat.viewport.following).toBe(false);
		chat.viewport.scheduleScrollToBottom();
		fixture.settle();
		expect(chat.viewport.following).toBe(false);
		chat.viewport.scrollToBottom();
		signals.flush();
		expect(chat.viewport.following).toBe(true);
		chat.setVisible(false);
		fixture.settle();
		chat.element.scrollHeight = 6000;
		chat.scroll(0);
		chat.setVisible(true);
		fixture.settle();
		expect(chat.element.scrollTop).toBe(5700);
		expect(chat.viewport.following).toBe(true);
		chat.scroll(5000); // Layout correction, without upward user intent.
		expect(chat.viewport.following).toBe(true);
	} finally {
		chat.dispose();
	}
});

test("paused position survives cache eviction and waits for transcript and visible layout", () => {
	const fixture = setup();
	const original = fixture.mount();
	fixture.settle();
	original.wheel(-100);
	original.scroll(800);
	original.dispose();
	for (let i = 0; i < 20; i++) fixture.chatViewportState(`other-${i}`);
	const restored = fixture.mount("one", false);
	try {
		restored.element.clientHeight = 0;
		fixture.settle();
		expect(restored.viewport.following).toBe(false);
		expect(restored.element.scrollTop).toBe(0);
		restored.setReady(true);
		fixture.settle();
		restored.element.clientHeight = 300;
		fixture.resize();
		fixture.settle();
		expect(restored.element.scrollTop).toBe(800);
		expect(restored.viewport.following).toBe(false);
	} finally {
		restored.dispose();
	}
});

test("scrollbar dragging pauses only that thread and upward input cancels a pending jump", () => {
	const fixture = setup();
	const one = fixture.mount("one");
	const two = fixture.mount("two");
	try {
		fixture.settle();
		one.element.dispatchEvent(new Event("pointerdown"));
		one.scroll(400);
		fixture.window.dispatchEvent(new Event("pointerup"));
		expect(one.viewport.following).toBe(false);
		expect(two.viewport.following).toBe(true);
		one.viewport.scrollToBottom();
		one.viewport.scheduleScrollToBottom();
		one.wheel(-50);
		one.scroll(1000);
		fixture.settle();
		expect(one.viewport.following).toBe(false);
		expect(one.element.scrollTop).toBe(1000);
	} finally {
		one.dispose();
		two.dispose();
	}
});

test("Page Up from a message action pauses following without intercepting editable or button input", () => {
	const fixture = setup();
	const chat = fixture.mount();
	const key = (value: string, shiftKey = false) => {
		chat.element.dispatchEvent(
			Object.assign(new Event("keydown"), { key: value, shiftKey }),
		);
		signals.flush();
	};
	try {
		fixture.settle();
		chat.element.closest = (selector) =>
			selector.includes("button") ? chat.element : null;
		key(" ", true);
		expect(chat.viewport.following).toBe(true);
		key("PageUp");
		chat.scroll(1200);
		expect(chat.viewport.following).toBe(false);
		chat.setVisible(false);
		fixture.settle();
		chat.setVisible(true);
		fixture.settle();
		expect(chat.element.scrollTop).toBe(1200);
		chat.viewport.scrollToBottom();
		chat.element.closest = (selector) =>
			selector.includes("textarea") ? chat.element : null;
		key("ArrowUp");
		expect(chat.viewport.following).toBe(true);
	} finally {
		chat.dispose();
	}
});
