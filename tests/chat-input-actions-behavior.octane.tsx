import { JSDOM } from "jsdom";
import { createRoot, useRef, useState } from "octane";
import { expect, test, vi } from "vitest";
import type { ChatMessage } from "../src/modules/conversation/model/agent-chat-shared.ts";

const mock = Object.assign(vi.fn, {
	module: (path: string, factory: () => unknown) => vi.doMock(path, factory),
});
const sendMock = mock(() => {});

mock.module("../src/adapters/backend/websocket.ts", () => ({
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

test.each([
	["second", true],
	["second /review", true],
	["/review", true],
	["/review", false],
] as const)(
	"loading Codex chat sends %s for native expansion without resetting the active stream",
	async (text, isLoading) => {
		sendMock.mockClear();
		const { root, rootElement } = setupDom();
		const { useChatInputActions } = await import(
			"../src/modules/conversation/hooks/useChatInputActions.tsx"
		);
		try {
			const onSendStart = mock(() => {});
			const setRunStatus = mock(() => {});
			let handleEnter: (event: KeyboardEvent) => void = (_event) => {
				throw new Error("handleKeyDown was not initialized");
			};
			function Harness() {
				const [input, setInput] = useState("");
				const [messages, setMessages] = useState<ChatMessage[]>([]);
				const textareaRef = useRef<HTMLTextAreaElement | null>(null);
				const { handleKeyDown } = useChatInputActions({
					agentKind: "codex",
					allCommands: [
						{
							id: "review-id",
							name: "review",
							description: "Review",
							action: "send",
						},
					],
					attachedImages: [],
					cancelSpeechListening: () => {},
					clearAttachedImages: () => {},
					clearCheckpoints: () => {},
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
					input,
					isLoading,
					paneId: "pane-live-textarea-queue",
					onSendStart,
					selectCommand: () => {},
					selectFile: () => {},
					selectedReasoningLevel: "medium",
					setFileMenu: () => {},
					setInput,
					setMessages,
					setRunStatus,
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
						data-command={messages.at(-1)?.render?.command?.name}
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
			textarea.value = text;
			handleEnter({
				key: "Enter",
				preventDefault: () => {},
				repeat: false,
				shiftKey: false,
			} as KeyboardEvent);
			await tick(20);

			const calls = sendMock.mock.calls as unknown as Array<
				[Record<string, unknown>]
			>;
			const payload = calls.at(-1)?.[0];
			expect(payload?.type).toBe("chat:send");
			expect(payload?.paneId).toBe("pane-live-textarea-queue");
			expect(payload?.text).toBe(text);
			expect(payload?.displayText).toBe(text);
			expect(payload?.expandCommands).toBe(true);
			expect(payload?.commandId).toBe(
				text === "/review" ? "review-id" : undefined,
			);
			expect(textarea.value).toBe("");
			expect(onSendStart).toHaveBeenCalledTimes(isLoading ? 0 : 1);
			expect(setRunStatus).toHaveBeenCalledTimes(isLoading ? 0 : 1);
			if (!isLoading) expect(textarea.dataset.command).toBe("review");

			textarea.value = text;
			handleEnter({
				key: "Enter",
				preventDefault: () => {},
				repeat: true,
				shiftKey: false,
			} as KeyboardEvent);
			await tick(20);
			expect(sendMock).toHaveBeenCalledTimes(1);
		} finally {
			root.unmount();
		}
	},
);
