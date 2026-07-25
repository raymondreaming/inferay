import { expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { userDataPath } from "../src/lib/user-data.ts";
import {
	ChatService,
	createQueuedDrainSendInput,
	readChatTranscript,
	readPersistedChatReconnectSnapshot,
	shouldAppendGenerationStoppedMessage,
	writeChatTranscript,
} from "../src/server/services/agent-chat.ts";

test("chat transcript reads reuse cached disk data without leaking mutable objects", async () => {
	const paneId = `test-transcript-cache-${crypto.randomUUID()}`;
	const path = userDataPath("chat-transcripts", `${paneId}.json`);
	try {
		await mkdir(dirname(path), { recursive: true });
		await Bun.write(
			path,
			JSON.stringify([
				{ id: "m1", role: "assistant", content: "cached from disk" },
			])
		);

		const first = await readChatTranscript(paneId);
		expect(first?.[0]?.content).toBe("cached from disk");
		if (!first?.[0]) throw new Error("Missing first transcript message");
		first[0].content = "mutated by caller";

		await Bun.write(
			path,
			JSON.stringify([{ id: "m1", role: "assistant", content: "disk changed" }])
		);

		const second = await readChatTranscript(paneId);
		expect(second?.[0]?.content).toBe("cached from disk");
		expect(second).not.toBe(first);
		expect(second?.[0]).not.toBe(first[0]);
	} finally {
		await rm(path, { force: true });
	}
});

test("chat transcript writes cache the storage-safe message shape", async () => {
	const paneId = `test-transcript-write-cache-${crypto.randomUUID()}`;
	const path = userDataPath("chat-transcripts", `${paneId}.json`);
	try {
		await writeChatTranscript(paneId, [
			{
				id: "m1",
				role: "assistant",
				content: "done",
				isStreaming: true,
			},
		]);

		const fromCache = await readChatTranscript(paneId);
		const fromDisk = (await Bun.file(path).json()) as Array<{
			isStreaming?: boolean;
		}>;
		expect(fromCache?.[0]?.isStreaming).toBe(false);
		expect(fromDisk[0]?.isStreaming).toBe(false);
	} finally {
		await rm(path, { force: true });
	}
});

test("chat restore prefers bounded transcript snapshots over large event logs", async () => {
	const paneId = `test-event-log-restore-${crypto.randomUUID()}`;
	const transcriptPath = userDataPath("chat-transcripts", `${paneId}.json`);
	const eventPath = userDataPath("chat-events", `${paneId}.jsonl`);
	try {
		await mkdir(dirname(transcriptPath), { recursive: true });
		await mkdir(dirname(eventPath), { recursive: true });
		await Bun.write(
			transcriptPath,
			JSON.stringify([
				{ id: "stale", role: "assistant", content: "stale snapshot" },
			])
		);
		await Bun.write(
			eventPath,
			[
				{
					paneId,
					sequence: 1,
					timestamp: Date.now(),
					type: "user_message",
					payload: {
						text: "expanded prompt",
						displayText: "/status",
						images: ["image.png"],
					},
				},
				{
					paneId,
					sequence: 2,
					timestamp: Date.now(),
					type: "agent_event",
					payload: {
						type: "content_block_start",
						content_block: { type: "text", text: "fresh " },
					},
				},
				{
					paneId,
					sequence: 3,
					timestamp: Date.now(),
					type: "agent_event",
					payload: {
						type: "content_block_delta",
						delta: { type: "text_delta", text: "event log" },
					},
				},
				{
					paneId,
					sequence: 4,
					timestamp: Date.now(),
					type: "agent_event",
					payload: { type: "content_block_stop" },
				},
			]
				.map((entry) => JSON.stringify(entry))
				.join("\n")
		);

		const restored = await ChatService.readRestoredMessages(paneId);

		expect(restored).toEqual([
			{ id: "stale", role: "assistant", content: "stale snapshot" },
		]);
	} finally {
		await Promise.all([
			rm(transcriptPath, { force: true }),
			rm(eventPath, { force: true }),
		]);
	}
});

test("queue-only event logs do not mask transcript snapshots", async () => {
	const paneId = `test-queue-only-log-${crypto.randomUUID()}`;
	const transcriptPath = userDataPath("chat-transcripts", `${paneId}.json`);
	const queuePath = userDataPath("chat-queues", `${paneId}.json`);
	const eventPath = userDataPath("chat-events", `${paneId}.jsonl`);
	try {
		await writeChatTranscript(paneId, [
			{ id: "snapshot-1", role: "assistant", content: "from snapshot" },
		]);
		await ChatService.saveQueue(paneId, [
			{ id: "queued-1", text: "queued", displayText: "queued" },
		]);

		const restored = await ChatService.readRestoredMessages(paneId);
		expect(restored).toEqual([
			{ id: "snapshot-1", role: "assistant", content: "from snapshot" },
		]);

		const snapshot = await readPersistedChatReconnectSnapshot(paneId);
		expect(snapshot.sync).toMatchObject({
			type: "chat:sync",
			paneId,
			isStreaming: false,
			revision: 0,
			messages: [
				{ id: "snapshot-1", role: "assistant", content: "from snapshot" },
			],
		});
		expect(snapshot.queue).toMatchObject({
			type: "chat:queue",
			paneId,
			queue: [{ id: "queued-1", text: "queued", displayText: "queued" }],
		});
		expect(snapshot.status).toMatchObject({
			type: "chat:status",
			paneId,
			status: "idle",
			isLoading: false,
		});
	} finally {
		await Promise.all([
			rm(transcriptPath, { force: true }),
			rm(queuePath, { force: true }),
			rm(eventPath, { force: true }),
		]);
	}
});

test("persisted reconnect snapshots preserve long transcript snapshots", async () => {
	const paneId = `test-long-reconnect-${crypto.randomUUID()}`;
	const transcriptPath = userDataPath("chat-transcripts", `${paneId}.json`);
	try {
		const messages = Array.from({ length: 1_200 }, (_, index) => ({
			id: `m${index}`,
			role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
			content: `short message ${index}`,
		}));
		await writeChatTranscript(paneId, messages);

		const snapshot = await readPersistedChatReconnectSnapshot(paneId);

		expect(snapshot.sync.messages).toHaveLength(1_200);
		expect(snapshot.sync.messages[0]?.id).toBe("m0");
		expect(snapshot.sync.messages.at(-1)?.id).toBe("m1199");
		expect(snapshot.sync.isStreaming).toBe(false);
		expect(snapshot.status).toMatchObject({
			type: "chat:status",
			paneId,
			status: "idle",
			isLoading: false,
		});
	} finally {
		await rm(transcriptPath, { force: true });
	}
});

test("chat queue persistence records compact runtime events", async () => {
	const paneId = `test-queue-events-${crypto.randomUUID()}`;
	const queuePath = userDataPath("chat-queues", `${paneId}.json`);
	const eventPath = userDataPath("chat-events", `${paneId}.jsonl`);
	try {
		await ChatService.saveQueue(paneId, [
			{ id: "queued-1", text: "first", displayText: "first" },
			{ id: "queued-2", text: "second", displayText: "second" },
		]);
		await ChatService.deleteQueue(paneId);

		const events = await ChatService.readEvents(paneId);
		expect(
			events.map((event) => ({ type: event.type, payload: event.payload }))
		).toEqual([
			{
				type: "queue_persisted",
				payload: {
					source: "api",
					count: 2,
					messageIds: ["queued-1", "queued-2"],
				},
			},
			{
				type: "queue_persisted",
				payload: {
					source: "api",
					count: 0,
					messageIds: [],
				},
			},
		]);
	} finally {
		await Promise.all([
			rm(queuePath, { force: true }),
			rm(eventPath, { force: true }),
		]);
	}
});

test("queued drain send input preserves image attachments", () => {
	const input = createQueuedDrainSendInput(
		{
			agentKind: "claude",
			sessionId: "session-1",
			cwd: "/tmp/project",
			model: "sonnet",
			reasoningLevel: "medium",
			referencePaths: ["/tmp/reference"],
		},
		"pane-drain-images",
		{
			id: "queued-image",
			text: "expanded image prompt",
			displayText: "image prompt",
			images: ["/tmp/image.png"],
		}
	);

	expect(input).toMatchObject({
		agentKind: "claude",
		clientSessionId: "session-1",
		cwd: "/tmp/project",
		model: "sonnet",
		paneId: "pane-drain-images",
		reasoningLevel: "medium",
		referencePaths: ["/tmp/reference"],
		displayText: "image prompt",
		images: ["/tmp/image.png"],
		text: "expanded image prompt",
	});
});

test("generation stopped marker is appended once", () => {
	expect(
		shouldAppendGenerationStoppedMessage([
			{ role: "assistant", content: "partial answer" },
		])
	).toBe(true);
	expect(
		shouldAppendGenerationStoppedMessage([
			{ role: "system", content: "Generation stopped" },
		])
	).toBe(false);
	expect(
		shouldAppendGenerationStoppedMessage([
			{ role: "system", content: "Generation stopped   " },
		])
	).toBe(false);
});
