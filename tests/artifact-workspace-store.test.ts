import { describe, expect, test } from "bun:test";
import {
	createDocumentArtifact,
	loadArtifactWorkspace,
	loadDocumentArtifacts,
} from "../src/features/artifacts/artifact-workspace-store.ts";

function installMemoryLocalStorage(options?: { failWrites?: boolean }) {
	const values = new Map<string, string>();
	globalThis.localStorage = {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key: string) => values.get(key) ?? null,
		key: (index: number) => [...values.keys()][index] ?? null,
		removeItem: (key: string) => {
			values.delete(key);
		},
		setItem: (key: string, value: string) => {
			if (options?.failWrites) throw new Error("storage full");
			values.set(key, String(value));
		},
	} as Storage;
}

describe("artifact workspace store", () => {
	test("loads chat-saved document artifacts into the artifact workspace", async () => {
		installMemoryLocalStorage();

		const saved = await createDocumentArtifact({
			title: "Implementation notes",
			subtitle: "assistant message",
			content: "Use the existing workspace store for saved notes.",
			sourcePaneId: "pane-1",
			sourceMessageId: "message-1",
			sourceRole: "assistant",
			projectPath: "/Users/ray/project",
			createdAt: 123,
		});

		expect(loadDocumentArtifacts()).toEqual([saved]);
		expect(loadArtifactWorkspace([], [])).toContainEqual(
			expect.objectContaining({
				id: `document:${saved.id}`,
				kind: "document",
				title: "Implementation notes",
				content: "Use the existing workspace store for saved notes.",
			})
		);
	});

	test("does not report a document artifact as saved when storage rejects it", async () => {
		installMemoryLocalStorage({ failWrites: true });

		await createDocumentArtifact({
			title: "Too large",
			content: "content",
		}).then(
			() => {
				throw new Error("Expected document artifact save to fail.");
			},
			(error: unknown) => {
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).message).toBe(
					"Failed to save document artifact."
				);
			}
		);
		expect(loadDocumentArtifacts()).toEqual([]);
	});
});
