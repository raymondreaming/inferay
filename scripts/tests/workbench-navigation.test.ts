import { describe, expect, test } from "bun:test";
import type { PanelAction, PanelSession } from "@contracts";
import { QueryClient } from "@tanstack/query-core";
import { createWorkspacePanelModel } from "@workspace/hooks/useWorkspacePanelSession.tsx";
import { project } from "../../src/shared/lib/native.tsx";

function setup() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	const empty = project<PanelSession>("emptyPanels", null);
	const sent: unknown[] = [];
	let read = () => Promise.resolve({ session: empty });
	const send = (body: unknown) => {
		sent.push(body);
		return read();
	};
	const model = createWorkspacePanelModel(client, send, empty);
	const key = model.queryOptions("repo").queryKey;
	client.setQueryData(key, empty);
	return {
		client,
		model,
		sent,
		empty,
		current: () => client.getQueryData<any>(key),
		select: (
			id: string,
			intent?: Extract<PanelAction, { type: "selectGraph" }>["intent"],
			orderedIds: string[] = [],
		) => model.preview("repo", { type: "selectGraph", id, intent, orderedIds }),
		mutation: model.mutationOptions("repo"),
		setRead: (next: typeof read) => {
			read = next;
		},
	};
}

describe("navigation while native persistence is pending", () => {
	test("disposing a panel model lets pending reads and saves settle", async () => {
		const { model, select, current, mutation, setRead, empty } = setup();
		const response = Promise.withResolvers<{ session: PanelSession }>();
		setRead(() => response.promise);
		const reading = model.queryOptions("repo").queryFn();
		const request = select("a");
		model.dispose();
		model.dispose();
		mutation.onError(new Error("offline"), request);
		response.resolve({ session: empty });
		expect((await reading).selectedCommitHash).toBeNull();
		expect(current().selectedCommitHash).toBeNull();
	});

	test("the query mutation queue saves in order while navigation stays ahead", async () => {
		const { client, select, current, mutation, setRead, sent } = setup();
		const started = Promise.withResolvers<void>();
		const response = Promise.withResolvers<any>();
		setRead(() => {
			started.resolve();
			return response.promise;
		});
		const first = select("a");
		const savedA = current();
		const savingA = client
			.getMutationCache()
			.build(client, mutation)
			.execute(first);
		await started.promise;
		const second = select("b");
		const savedB = current();
		const savingB = client
			.getMutationCache()
			.build(client, mutation)
			.execute(second);
		expect(current().selectedCommitHash).toBe("b");
		expect(sent).toHaveLength(1);
		setRead(() => Promise.resolve({ session: savedB }));
		response.resolve({ session: savedA });
		await savingA;
		expect(current().selectedCommitHash).toBe("b");
		await savingB;
		expect(current().selectedCommitHash).toBe("b");
		expect(sent.map((body) => (body as any).action.id)).toEqual(["a", "b"]);
		client.clear();
	});

	test("a failed save preserves newer navigation and rolls back if all saves fail", () => {
		const { select, current, mutation } = setup();
		const first = select("a");
		const second = select("b");
		mutation.onError(new Error("offline"), first);
		expect(current().selectedCommitHash).toBe("b");
		mutation.onError(new Error("offline"), second);
		expect(current().selectedCommitHash).toBeNull();
	});

	test.each([false, true])(
		"an overlapping session read cannot undo navigation (saved=%s)",
		async (saved) => {
			const { model, select, current, mutation, setRead, empty } = setup();
			const deferred = Promise.withResolvers<any>();
			setRead(() => deferred.promise);
			const reading = model.queryOptions("repo").queryFn();
			const action = select("a");
			if (saved) mutation.onSuccess({ session: current() }, action);
			deferred.resolve({ session: empty });
			expect((await reading).selectedCommitHash).toBe("a");
		},
	);

	test("file preview opens immediately and retains local content without serializing it", async () => {
		const { model, current, mutation, sent } = setup();
		model.preview("repo", {
			type: "commitFile",
			cwd: "/repo",
			path: "a.rs",
			commitHash: "a",
			commitParent: null,
		});
		expect(current().selectedFile.path).toBe("a.rs");
		expect(current().diffViewerCwd).toBe("/repo");
		const initialFile = {
			cwd: "/repo",
			path: "a.rs",
			content: "large document",
			toJSON() {
				throw new Error("file content crossed panel bridge");
			},
		};
		const detached = model.preview("repo", {
			type: "detachFile",
			id: "file",
			cwd: "/repo",
			path: "a.rs",
			initialFile,
		});
		expect(current().detachedFilePanels[0].initialFile).toBe(initialFile);
		await mutation.mutationFn(detached);
		expect((sent[0] as any).action.initialFile).toBeUndefined();
		model.preview("repo", {
			type: "focus",
			panel: { id: "file", cwd: "/repo" },
		});
		expect(current().detachedFilePanels[0].initialFile).toBe(initialFile);
	});
});

test("file navigation preserves object identity without serializing file payloads", async () => {
	const { adjacentGitFile } = await import("../../src/shared/lib/native.tsx");
	const files = [0, 1, 2].map((id) => ({
		id,
		toJSON() {
			throw new Error("File payload must stay in the renderer");
		},
	}));
	expect(adjacentGitFile(files, (file) => file.id === 1, 1)).toBe(files[2]);
	expect(adjacentGitFile(files, (file) => file.id === 1, -1)).toBe(files[0]);
	expect(adjacentGitFile(files, () => false, 1)).toBe(files[0]);
	expect(adjacentGitFile(files, () => false, -1)).toBe(files[2]);
	expect(adjacentGitFile(files, (file) => file.id === 2, 1)).toBeUndefined();
	expect(adjacentGitFile(files, (file) => file.id === 2, 1, true)).toBe(
		files[2],
	);
	expect(adjacentGitFile(files, (file) => file.id === 0, -1)).toBeUndefined();
	expect(adjacentGitFile([], () => false, 1, true)).toBeUndefined();
});
