import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createChatQueueStore } from "../src/server/services/chat-queues.ts";
import { createDocumentArtifactStore } from "../src/server/services/document-artifacts.ts";

async function tempDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "inferay-storage-"));
}

describe("durable storage services", () => {
	test("stores chat queues by pane in a file-backed store", async () => {
		const root = await tempDir();
		try {
			const store = createChatQueueStore(root);
			await store.saveChatQueue("pane-1", [
				{ id: "q1", text: "first", displayText: "first" },
			]);

			expect(await store.loadChatQueue("pane-1")).toEqual([
				{ id: "q1", text: "first", displayText: "first" },
			]);
			expect(await store.loadChatQueue("pane-2")).toEqual([]);

			await store.deleteChatQueue("pane-1");
			expect(await store.loadChatQueue("pane-1")).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("stores document artifact bodies as files and keeps the index small", async () => {
		const root = await tempDir();
		try {
			const store = createDocumentArtifactStore({ dir: root });
			const [artifact] = await store.saveDocumentArtifacts([
				{
					id: "doc-1",
					title: "Artifact",
					subtitle: "assistant message",
					content: "Long artifact body",
					contentPath: null,
					sourcePaneId: "pane-1",
					sourceMessageId: "message-1",
					sourceRole: "assistant",
					projectPath: "/repo",
					createdAt: 1,
					updatedAt: 2,
				},
			]);

			if (!artifact) throw new Error("Expected saved artifact.");
			expect(artifact.content).toBe("Long artifact body");
			expect(artifact.contentPath?.endsWith("doc-1.md")).toBe(true);
			expect(await readFile(artifact.contentPath!, "utf8")).toBe(
				"Long artifact body"
			);

			const index = await readFile(join(root, "index.json"), "utf8");
			expect(index).toContain("doc-1.md");
			expect(index).not.toContain("Long artifact body");
			expect(await store.loadDocumentArtifacts()).toEqual([artifact]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
