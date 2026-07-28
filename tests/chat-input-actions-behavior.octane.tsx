import { JSDOM } from "jsdom";
import { createRoot, useRef, useState } from "octane";
import { expect, test, vi } from "vitest";
import type { ChatMessage } from "../src/features/chat/agent-chat-shared.ts";

const mock = Object.assign(vi.fn, {
	module: (path: string, factory: () => unknown) => vi.doMock(path, factory),
});
const sendMock = mock(() => {});

mock.module("../src/lib/websocket.ts", () => ({
	getWebSocketStatus: () => "connected",
	subscribeWebSocketStatus: () => () => {},
	wsClient: {
		onMessage: mock(() => () => {}),
		send: sendMock,
	},
}));

function setupDom() {
	const dom = new JSDOM('<div id="root"></div>', {
		pretendToBeVisual: true,
		url: "http://localhost/#/agent",
	});
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: dom.window,
	});
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: dom.window.document,
	});
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: dom.window.localStorage,
	});
	Object.defineProperty(globalThis, "crypto", {
		configurable: true,
		value: dom.window.crypto,
	});
	const rootElement = dom.window.document.getElementById("root");
	if (!rootElement) throw new Error("Missing root element");
	return { root: createRoot(rootElement), rootElement };
}

function tick(ms = 0) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

test("hidden chat input actions defer pending sends until visible", async () => {
	sendMock.mockClear();
	const { root, rootElement } = setupDom();
	const { clearPendingSend, loadPendingSend, savePendingSend } =
		await import("../src/features/chat/chat-session-store.ts");
	const { useChatInputActions } =
		await import("../src/components/chat/useChatInputActions.tsx");
	const paneId = "pane-hidden-pending-send";
	clearPendingSend(paneId);
	savePendingSend(paneId, "deferred hello");
	try {
		function Harness({ enabled }: { enabled: boolean }) {
			const [messages, setMessages] = useState<ChatMessage[]>([]);
			const textareaRef = useRef<HTMLTextAreaElement | null>(null);
			useChatInputActions({
				agentKind: "codex",
				allCommands: [],
				attachedImages: [],
				cancelSpeechListening: () => {},
				clearAttachedImages: () => {},
				clearCheckpoints: () => {},
				composerOnly: false,
				consumePendingWorkspace: () => undefined,
				cwd: "/tmp/project",
				effectiveSelectedModel: "gpt-5",
				enabled,
				fileMenu: {
					show: false,
					selectedIdx: 0,
					query: "",
					atIndex: -1,
					position: null,
				},
				fileResults: [],
				filteredCommands: [],
				incrementUsage: () => Promise.resolve(),
				input: "",
				isLoading: false,
				paneId,
				selectCommand: () => {},
				selectFile: () => {},
				selectedReasoningLevel: "medium",
				setFileMenu: () => {},
				setInput: () => {},
				setMessages,
				setRunStatus: () => {},
				setSlashMenu: () => {},
				showCommands: false,
				slashMenu: {
					show: false,
					selectedIdx: 0,
					query: "",
					slashIndex: -1,
				},
				textareaRef,
			});
			return (
				<div
					data-messages={messages.map((message) => message.content).join("|")}
				/>
			);
		}

		root.render(<Harness enabled={false} />);
		await tick(20);
		expect(sendMock).toHaveBeenCalledTimes(0);
		expect(loadPendingSend(paneId)).toBe("deferred hello");
		expect(rootElement.firstElementChild?.getAttribute("data-messages")).toBe(
			""
		);

		root.render(<Harness enabled={true} />);
		await tick(20);
		expect(sendMock).toHaveBeenCalledTimes(1);
		expect(loadPendingSend(paneId)).toBe("");
		expect(rootElement.firstElementChild?.getAttribute("data-messages")).toBe(
			"deferred hello"
		);
	} finally {
		root.unmount();
		clearPendingSend(paneId);
	}
});

test("loading chat sends the live textarea value to the server queue", async () => {
	sendMock.mockClear();
	const { root, rootElement } = setupDom();
	const { useChatInputActions } =
		await import("../src/components/chat/useChatInputActions.tsx");
	try {
		let handleEnter: (event: KeyboardEvent) => void = (_event) => {
			throw new Error("handleKeyDown was not initialized");
		};
		function Harness() {
			const [input, setInput] = useState("");
			const textareaRef = useRef<HTMLTextAreaElement | null>(null);
			const { handleKeyDown } = useChatInputActions({
				agentKind: "codex",
				allCommands: [],
				attachedImages: [],
				cancelSpeechListening: () => {},
				clearAttachedImages: () => {},
				clearCheckpoints: () => {},
				composerOnly: false,
				consumePendingWorkspace: () => undefined,
				cwd: "/tmp/project",
				effectiveSelectedModel: "gpt-5",
				fileMenu: {
					show: false,
					selectedIdx: 0,
					query: "",
					atIndex: -1,
					position: null,
				},
				fileResults: [],
				filteredCommands: [],
				incrementUsage: () => Promise.resolve(),
				input,
				isLoading: true,
				paneId: "pane-live-textarea-queue",
				selectCommand: () => {},
				selectFile: () => {},
				selectedReasoningLevel: "medium",
				setFileMenu: () => {},
				setInput,
				setMessages: () => {},
				setRunStatus: () => {},
				setSlashMenu: () => {},
				showCommands: false,
				slashMenu: {
					show: false,
					selectedIdx: 0,
					query: "",
					slashIndex: -1,
				},
				textareaRef,
			});
			handleEnter = handleKeyDown;
			return (
				<textarea
					ref={textareaRef}
					value={input}
					onInput={(event) => setInput(event.currentTarget.value)}
				/>
			);
		}

		root.render(<Harness />);
		await tick(20);
		const textarea =
			rootElement.firstElementChild as HTMLTextAreaElement | null;
		if (!textarea) throw new Error("Missing textarea");
		textarea.value = "second";
		handleEnter({
			key: "Enter",
			preventDefault: () => {},
			shiftKey: false,
		} as KeyboardEvent);
		await tick(20);

		const calls = sendMock.mock.calls as unknown as Array<
			[Record<string, unknown>]
		>;
		const payload = calls.at(-1)?.[0];
		expect(payload?.type).toBe("chat:send");
		expect(payload?.paneId).toBe("pane-live-textarea-queue");
		expect(payload?.text).toBe("second");
		expect(payload?.displayText).toBe("second");
		expect(textarea.value).toBe("");
	} finally {
		root.unmount();
	}
});
