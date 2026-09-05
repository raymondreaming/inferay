import { expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";

function installBrowserStorage() {
	const dom = new JSDOM("<!doctype html><html><body></body></html>", {
		url: "http://localhost/#/agent",
	});
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const previousDocument = Object.getOwnPropertyDescriptor(
		globalThis,
		"document",
	);
	const previousLocalStorage = Object.getOwnPropertyDescriptor(
		globalThis,
		"localStorage",
	);
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
	return () => {
		if (previousWindow)
			Object.defineProperty(globalThis, "window", previousWindow);
		else delete (globalThis as { window?: unknown }).window;
		if (previousDocument)
			Object.defineProperty(globalThis, "document", previousDocument);
		else delete (globalThis as { document?: unknown }).document;
		if (previousLocalStorage)
			Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
		else delete (globalThis as { localStorage?: unknown }).localStorage;
	};
}

test("chat startup clears legacy localStorage message blobs", async () => {
	const restoreBrowserStorage = installBrowserStorage();
	try {
		const { cleanupStaleChatClientStorage } = await import(
			"../src/modules/conversation/model/chat-session-store.ts"
		);
		localStorage.setItem(
			"inferay-chat-pane-a",
			JSON.stringify([{ id: "s3", role: "assistant", content: "legacy" }]),
		);

		cleanupStaleChatClientStorage();
		expect(localStorage.getItem("inferay-chat-pane-a")).toBeNull();
	} finally {
		restoreBrowserStorage();
	}
});

test("queue mutations serialize commands and preserve snapshots on server failure", async () => {
	const restore = installBrowserStorage();
	const previousFetch = globalThis.fetch;
	const requests: Array<{ action: string; id: string; text?: string }> = [];
	let resolveFirst!: (response: Response) => void;
	globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
		if (!String(_input).includes("/api/chat-queues/"))
			return Promise.resolve(Response.json({ ok: true }));
		expect(init?.method).toBe("PATCH");
		requests.push(JSON.parse(String(init?.body)));
		if (requests.length === 1)
			return new Promise<Response>((resolve) => {
				resolveFirst = resolve;
			});
		return Promise.resolve(
			Response.json({ error: "disk full" }, { status: 500 }),
		);
	}) as typeof fetch;
	try {
		const { getChatQueueReadModel } = await import(
			"../src/modules/conversation/model/chat-session-store.ts"
		);
		const model = getChatQueueReadModel("pane-command-order");
		model.replaceFromServer([
			{ id: "q1", text: "original", displayText: "original" },
		]);
		const first = model.mutate("edit", "q1", "updated");
		const second = model.mutate("remove", "q1");
		const failure = second.catch((error) => error);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(requests).toEqual([{ action: "edit", id: "q1", text: "updated" }]);
		expect(model.getSnapshot()[0]?.text).toBe("original");
		resolveFirst(
			Response.json({
				queue: [{ id: "q1", text: "updated", displayText: "updated" }],
			}),
		);
		await first;
		expect((await failure).message).toContain(
			"Could not update queued message",
		);
		expect(requests[1]).toEqual({ action: "remove", id: "q1" });
		expect(model.getSnapshot()[0]?.text).toBe("updated");
	} finally {
		globalThis.fetch = previousFetch;
		restore();
	}
});

test("queue mutation response cannot replace a newer server snapshot", async () => {
	const restore = installBrowserStorage();
	const previousFetch = globalThis.fetch;
	let finish!: (response: Response) => void;
	globalThis.fetch = mock(
		() =>
			new Promise<Response>((resolve) => {
				finish = resolve;
			}),
	) as typeof fetch;
	try {
		const { getChatQueueReadModel } = await import(
			"../src/modules/conversation/model/chat-session-store.ts"
		);
		const model = getChatQueueReadModel("pane-stale-mutation");
		model.replaceFromServer([
			{ id: "q1", text: "original", displayText: "original" },
		]);
		const pending = model.mutate("edit", "q1", "edited");
		await new Promise((resolve) => setTimeout(resolve, 0));
		model.replaceFromServer([]);
		finish(
			Response.json({
				queue: [{ id: "q1", text: "edited", displayText: "edited" }],
			}),
		);
		await pending;
		expect(model.getSnapshot()).toEqual([]);
	} finally {
		globalThis.fetch = previousFetch;
		restore();
	}
});

test("chat queue restore ignores legacy local queue and preference rows", async () => {
	const restoreBrowserStorage = installBrowserStorage();
	try {
		const { loadStoredQueue } = await import(
			"../src/modules/conversation/model/chat-session-store.ts"
		);
		localStorage.setItem(
			"inferay-db-preferences",
			JSON.stringify([
				{
					id: "inferay-chat-queue-pane-direct-queue",
					valueJson: JSON.stringify([]),
					updatedAt: Date.now(),
				},
			]),
		);
		localStorage.setItem(
			"inferay-chat-queue-pane-direct-queue",
			JSON.stringify([{ id: "q1", text: "first", displayText: "first" }]),
		);

		expect(loadStoredQueue("pane-direct-queue")).toEqual([]);
		expect(
			localStorage.getItem("inferay-chat-queue-pane-direct-queue"),
		).toBeNull();
	} finally {
		restoreBrowserStorage();
	}
});

test("stale chat storage cleanup removes legacy transcript queue and db rows", async () => {
	const restoreBrowserStorage = installBrowserStorage();
	try {
		const { cleanupStaleChatClientStorage } = await import(
			"../src/modules/conversation/model/chat-session-store.ts"
		);
		localStorage.setItem(
			"inferay-chat-pane-stale",
			JSON.stringify([{ id: "m1", role: "assistant", content: "old" }]),
		);
		localStorage.setItem(
			"inferay-chat-queue-pane-stale",
			JSON.stringify([{ id: "q1", text: "queued", displayText: "queued" }]),
		);
		localStorage.setItem("inferay-db-conversations", "[]");
		localStorage.setItem("inferay-db-messages", "[]");
		localStorage.setItem("inferay-chat-input-pane-stays", "draft");
		localStorage.setItem(
			"inferay-db-preferences",
			JSON.stringify([
				{
					id: "inferay-chat-pane-stale",
					valueJson: JSON.stringify([{ id: "m1" }]),
					updatedAt: 1,
				},
				{
					id: "inferay-chat-queue-pane-stale",
					valueJson: JSON.stringify([{ id: "q1" }]),
					updatedAt: 2,
				},
				{
					id: "inferay-chat-input-pane-stays",
					valueJson: JSON.stringify("draft"),
					updatedAt: 3,
				},
			]),
		);

		cleanupStaleChatClientStorage();

		expect(localStorage.getItem("inferay-chat-pane-stale")).toBeNull();
		expect(localStorage.getItem("inferay-chat-queue-pane-stale")).toBeNull();
		expect(localStorage.getItem("inferay-db-conversations")).toBeNull();
		expect(localStorage.getItem("inferay-db-messages")).toBeNull();
		expect(localStorage.getItem("inferay-chat-input-pane-stays")).toBe("draft");
		const preferences = JSON.parse(
			localStorage.getItem("inferay-db-preferences") ?? "[]",
		) as Array<{ id: string }>;
		expect(preferences.map((entry) => entry.id)).toEqual([
			"inferay-chat-input-pane-stays",
		]);
	} finally {
		restoreBrowserStorage();
	}
});

test("chat message read model publishes updates and settles streamed messages", async () => {
	const restoreBrowserStorage = installBrowserStorage();
	try {
		const { getChatMessageReadModel } = await import(
			"../src/modules/conversation/model/chat-session-store.ts"
		);
		const model = getChatMessageReadModel("pane-read-model");
		let updateCount = 0;
		const unsubscribe = model.subscribe(() => {
			updateCount++;
		});

		model.set([
			{
				id: "m1",
				role: "assistant",
				content: "streaming answer",
				isStreaming: true,
			},
		]);

		expect(updateCount).toBe(1);
		expect(model.get().map((message) => message.id)).toEqual(["m1"]);
		expect(model.getSnapshot()).toBe(model.get());

		const stored = model.settle(model.get());
		expect(stored).toEqual([
			{
				id: "m1",
				role: "assistant",
				content: "streaming answer",
				isStreaming: false,
			},
		]);

		unsubscribe();
		model.set((prev) => [...prev, { id: "m2", role: "user", content: "next" }]);
		expect(updateCount).toBe(1);
	} finally {
		restoreBrowserStorage();
	}
});

test("chat message read model compacts adjacent duplicate assistant rows", async () => {
	const restoreBrowserStorage = installBrowserStorage();
	try {
		const { getChatMessageReadModel } = await import(
			"../src/modules/conversation/model/chat-session-store.ts"
		);
		const model = getChatMessageReadModel("pane-duplicate-assistant");

		model.set([
			{ id: "u1", role: "user", content: "improve this" },
			{ id: "a1", role: "assistant", content: "same answer" },
			{ id: "a2", role: "assistant", content: "same answer" },
		]);

		expect(model.get()).toEqual([
			{ id: "u1", role: "user", content: "improve this" },
			{ id: "a1", role: "assistant", content: "same answer" },
		]);
		expect(model.settle(model.get())).toEqual([
			{ id: "u1", role: "user", content: "improve this" },
			{ id: "a1", role: "assistant", content: "same answer" },
		]);
	} finally {
		restoreBrowserStorage();
	}
});

test("chat checkpoint read model publishes updates and clears durable rows", async () => {
	const restoreBrowserStorage = installBrowserStorage();
	try {
		const { getChatCheckpointReadModel, loadStoredCheckpoints } = await import(
			"../src/modules/conversation/model/chat-session-store.ts"
		);
		const model = getChatCheckpointReadModel("pane-checkpoint-model");
		let updateCount = 0;
		const unsubscribe = model.subscribe(() => {
			updateCount++;
		});
		const checkpoint = {
			id: "checkpoint-1",
			timestamp: 100,
			changedFileCount: 1,
			changedFiles: [{ path: "src/app.ts", action: "modified" as const }],
			reverted: false,
			afterMessageId: "assistant-1",
		};

		model.set([checkpoint]);

		expect(updateCount).toBe(1);
		expect(model.getSnapshot()).toEqual([checkpoint]);
		expect(loadStoredCheckpoints("pane-checkpoint-model")).toEqual([
			checkpoint,
		]);

		model.markReverted(checkpoint.id);
		expect(updateCount).toBe(2);
		expect(model.getSnapshot()[0]?.reverted).toBe(true);

		unsubscribe();
		model.clear();
		expect(updateCount).toBe(2);
		expect(model.getSnapshot()).toEqual([]);
		expect(loadStoredCheckpoints("pane-checkpoint-model")).toEqual([]);
	} finally {
		restoreBrowserStorage();
	}
});

test("chat checkpoint read model derives finalized checkpoints from settled assistant messages", async () => {
	const restoreBrowserStorage = installBrowserStorage();
	try {
		const { getChatCheckpointReadModel } = await import(
			"../src/modules/conversation/model/chat-session-store.ts"
		);
		const model = getChatCheckpointReadModel("pane-checkpoint-finalized");
		const messages = [
			{ id: "user-1", role: "user" as const, content: "change file" },
			{
				id: "assistant-1",
				role: "assistant" as const,
				content: "done",
				isStreaming: false,
			},
		];

		model.recordFinalized(
			{
				checkpointId: "checkpoint-final",
				changedFileCount: 2,
				changedFiles: [
					{ path: "src/a.ts", action: "modified" },
					{ path: "src/b.ts", action: "created" },
				],
				timestamp: 123,
			},
			messages,
		);
		model.recordFinalized(
			{
				checkpointId: "checkpoint-duplicate",
				changedFileCount: 1,
				changedFiles: [{ path: "src/c.ts", action: "modified" }],
				timestamp: 456,
			},
			messages,
		);

		expect(model.getSnapshot()).toEqual([
			{
				id: "checkpoint-final",
				timestamp: 123,
				changedFileCount: 2,
				changedFiles: [
					{ path: "src/a.ts", action: "modified" },
					{ path: "src/b.ts", action: "created" },
				],
				reverted: false,
				afterMessageId: "assistant-1",
			},
		]);
	} finally {
		restoreBrowserStorage();
	}
});

test("queue mutation invalidates an older startup load before its response arrives", async () => {
	const restore = installBrowserStorage();
	const previousFetch = globalThis.fetch;
	let finishLoad!: (response: Response) => void;
	let finishMutation!: (response: Response) => void;
	globalThis.fetch = mock(
		(_input: RequestInfo | URL, init?: RequestInit) =>
			new Promise<Response>((resolve) => {
				if (init?.method === "PATCH") finishMutation = resolve;
				else finishLoad = resolve;
			}),
	) as typeof fetch;
	try {
		const { getChatQueueReadModel } = await import(
			"../src/modules/conversation/model/chat-session-store.ts"
		);
		const model = getChatQueueReadModel("pane-load-before-command");
		const loading = model.loadAsync();
		const mutation = model.mutate("edit", "q1", "newer");
		await new Promise((resolve) => setTimeout(resolve, 0));
		finishLoad(
			Response.json({
				queue: [{ id: "q1", text: "stale", displayText: "stale" }],
			}),
		);
		await loading;
		expect(model.getSnapshot()).toEqual([]);
		finishMutation(
			Response.json({
				queue: [{ id: "q1", text: "newer", displayText: "newer" }],
			}),
		);
		await mutation;
		expect(model.getSnapshot()[0]?.text).toBe("newer");
	} finally {
		globalThis.fetch = previousFetch;
		restore();
	}
});

test("chat run status read model publishes updates and clears to idle", async () => {
	const restoreBrowserStorage = installBrowserStorage();
	try {
		const { getChatRunStatusReadModel } = await import(
			"../src/modules/conversation/model/chat-session-store.ts"
		);
		const model = getChatRunStatusReadModel("pane-run-status-model");
		let updateCount = 0;
		const unsubscribe = model.subscribe(() => {
			updateCount++;
		});

		expect(model.getSnapshot()).toEqual({
			isLoading: false,
			status: "idle",
			startTime: null,
		});

		model.set({ isLoading: true, status: "thinking", startTime: 100 });
		expect(updateCount).toBe(1);
		expect(model.get()).toEqual({
			isLoading: true,
			status: "thinking",
			startTime: 100,
		});

		model.set((prev) => ({ ...prev, status: "responding" }));
		expect(updateCount).toBe(2);
		expect(model.getSnapshot()).toEqual({
			isLoading: true,
			status: "responding",
			startTime: 100,
		});

		model.set((prev) => ({ ...prev }));
		expect(updateCount).toBe(2);

		unsubscribe();
		model.clear();
		expect(updateCount).toBe(2);
		expect(model.getSnapshot()).toEqual({
			isLoading: false,
			status: "idle",
			startTime: null,
		});
	} finally {
		restoreBrowserStorage();
	}
});

test("chat clear operations remove durable preference rows", async () => {
	const restoreBrowserStorage = installBrowserStorage();
	const previousFetch = globalThis.fetch;
	globalThis.fetch = mock(() =>
		Promise.resolve(Response.json({ ok: true })),
	) as unknown as typeof fetch;
	try {
		const {
			clearAgentChatPaneState,
			clearPendingSend,
			clearProviderSessionId,
			loadPendingSend,
			loadStoredInput,
			getProviderSessionId,
			savePendingSend,
			saveStoredInput,
			setProviderSessionId,
		} = await import("../src/modules/conversation/model/chat-session-store.ts");

		savePendingSend("pane-clear-pending", "send me");
		clearPendingSend("pane-clear-pending");
		expect(loadPendingSend("pane-clear-pending")).toBe("");

		setProviderSessionId("pane-clear-session", "session-id");
		clearProviderSessionId("pane-clear-session");
		expect(getProviderSessionId("pane-clear-session")).toBeNull();

		saveStoredInput("pane-clear-all", "draft");
		setProviderSessionId("pane-clear-all", "stale-session");
		clearAgentChatPaneState("pane-clear-all");
		expect(loadStoredInput("pane-clear-all")).toBe("");
		expect(getProviderSessionId("pane-clear-all")).toBeNull();
	} finally {
		globalThis.fetch = previousFetch;
		restoreBrowserStorage();
	}
});
