import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import { QueryClient } from "@tanstack/query-core";
import { project } from "../../src/shared/lib/native.tsx";

// Load the production models without compiling the Solid UI runtime. The
// transition itself runs through the built Rust Wasm, just as in the renderer.
function functions(
	path: string,
	names: string[],
	bindings: Record<string, unknown>,
) {
	const source = readFileSync(new URL(path, import.meta.url), "utf8");
	const declarations = parse(source, {
		sourceType: "module",
		plugins: ["typescript", "jsx"],
	}).program.body.flatMap((node) => {
		const declaration =
			node.type === "ExportNamedDeclaration" ? node.declaration : node;
		return declaration?.type === "FunctionDeclaration" &&
			names.includes(declaration.id?.name ?? "")
			? [source.slice(declaration.start!, declaration.end!)]
			: [];
	});
	expect(declarations).toHaveLength(names.length);
	const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(
		declarations.join("\n"),
	);
	return new Function(
		...Object.keys(bindings),
		`${code}\nreturn { ${names.join(",")} };`,
	)(...Object.values(bindings));
}

function setup() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	const empty = project("emptyPanels", null);
	const { createWorkspacePanelModel, panelQuery } = functions(
		"../../src/modules/workbench/hooks/useWorkspacePanelSession.tsx",
		["createWorkspacePanelModel", "panelQuery"],
		{
			queryClient: client,
			emptyPanelSession: empty,
			rustProject: project,
			postJson: () => {
				throw new Error("unexpected request");
			},
		},
	);
	const sent: unknown[] = [];
	let read = () => Promise.resolve({ session: empty });
	const send = (_url: string, body: unknown) => {
		sent.push(body);
		return read();
	};
	const model = createWorkspacePanelModel(client, send);
	const key = panelQuery("repo", send).queryKey;
	client.setQueryData(key, empty);
	return {
		client,
		model,
		sent,
		empty,
		current: () => client.getQueryData<any>(key),
		select: (id: string, intent?: unknown, orderedIds: string[] = []) =>
			model.preview("repo", { type: "selectGraph", id, intent, orderedIds }),
		mutation: model.mutationOptions("repo"),
		setRead: (next: typeof read) => {
			read = next;
		},
	};
}

describe("navigation while native persistence is pending", () => {
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

	test("selection moves immediately and an older acknowledgement cannot move it back", () => {
		const { select, current, mutation } = setup();
		const first = select("a");
		const firstSaved = current();
		expect(firstSaved.selectedCommitHash).toBe("a");
		const second = select("b");
		const secondSaved = current();
		expect(secondSaved.selectedCommitHash).toBe("b");
		mutation.onSuccess({ session: firstSaved }, first);
		expect(current().selectedCommitHash).toBe("b");
		mutation.onSuccess({ session: secondSaved }, second);
		expect(current().selectedCommitIds).toEqual(["b"]);
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

	test("failure after a successful save rolls back to the saved selection", () => {
		const { select, current, mutation } = setup();
		const first = select("a");
		const saved = current();
		const second = select("b");
		mutation.onSuccess({ session: saved }, first);
		mutation.onError(new Error("offline"), second);
		expect(current().selectedCommitHash).toBe("a");
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

	test("rapid range and additive selections retain native selection semantics", () => {
		const { select, current, mutation } = setup();
		const first = select("a");
		const saved = current();
		select("c", { range: true, additive: false }, ["a", "b", "c", "d"]);
		select("b", { additive: true, range: false });
		expect(current().selectedCommitIds).toEqual(["a", "c"]);
		mutation.onSuccess({ session: saved }, first);
		expect(current().selectedCommitIds).toEqual(["a", "c"]);
		expect(current().selectedCommitHash).toBe("c");
	});

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

test("compact diff facts preserve full-payload presentation for every view", () => {
	const { buildDiffViewerModel } = functions(
		"../../src/modules/workbench/diff/components/DiffViewer/index.tsx",
		["buildDiffViewerModel"],
		{ rustProject: project },
	);
	const line = (content: string, type = "context") => ({
		number: 1,
		type,
		content,
	});
	const base = {
		oldLines: [line("old")],
		newLines: [line("new", "add")],
		isBinary: false,
		metadata: {
			maxOldLineChars: 3,
			maxNewLineChars: 3,
			maxInlineLineChars: 3,
			maxConflictLineChars: 0,
			splitChangeRanges: [[0, 1]],
			inlineChangeRanges: [[0, 2]],
		},
	};
	for (const path of ["file.rs", "file.md", "file.mdx", "README.MD"])
		for (const viewMode of ["split", "hunks"])
			for (const diff of [
				base,
				{ ...base, isBinary: true },
				{ ...base, oldLines: [], newLines: [] },
				{
					...base,
					oldLines: [],
					newLines: [line("File is too large to display.")],
				},
				{ ...base, compactLines: [] },
				{ ...base, compactLines: [line("Diff unavailable")] },
				{
					...base,
					newLines: [
						line("# Title"),
						line("gone", "remove"),
						line("body", "add"),
					],
				},
				{
					...base,
					mergeConflictContent: "<<<<<<< ours\na\n=======\nb\n>>>>>>> theirs",
				},
			])
				expect(buildDiffViewerModel(diff, path, viewMode)).toEqual(
					project("diffViewer", { diff, filePath: path, viewMode }),
				);
});

test("repository tab selection matches native preference order", () => {
	const state = {
		selectedGroupId: "active",
		groups: [
			{ id: "other", selectedPaneId: "remembered" },
			{ id: "active", selectedPaneId: "elsewhere" },
		],
		repositories: {
			workspaces: [
				{
					cwd: "/repo",
					entries: [
						{ groupId: "other", pane: { id: "first" } },
						{ groupId: "other", pane: { id: "remembered" } },
						{ groupId: "active", pane: { id: "current" } },
					],
				},
			],
		},
	};
	expect(
		project<{ groupId: string; paneId: string } | null>("repositorySelection", {
			state,
			cwd: "/repo",
		}),
	).toEqual({ groupId: "active", paneId: "current" });
	state.selectedGroupId = "unrelated";
	expect(
		project<{ groupId: string; paneId: string } | null>("repositorySelection", {
			state,
			cwd: "/repo",
		}),
	).toEqual({ groupId: "other", paneId: "remembered" });
	expect(
		project<{ groupId: string; paneId: string } | null>("repositorySelection", {
			state,
			cwd: "/missing",
		}),
	).toBeNull();
});
