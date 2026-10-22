import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { PanelAction, PanelSession } from "@contracts";
import * as signals from "@solidjs/signals";
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

	test("file preview opens immediately and saves the selected historical source", async () => {
		const { model, current, mutation, sent } = setup();
		const request = model.preview("repo", {
			type: "commitFile",
			cwd: "/repo",
			path: "a.rs",
			commitHash: "a",
			commitParent: null,
		});
		expect(current().selectedFile).toEqual({
			path: "a.rs",
			staged: false,
			source: { kind: "commit", commitHash: "a", commitParent: null },
		});
		expect(current().diffViewerCwd).toBe("/repo");
		await mutation.mutationFn(request);
		expect(sent).toEqual([{ workspaceId: "repo", action: request.action }]);
	});
});

test("file navigation retains prepared changes, while selection and file updates refresh them", async () => {
	const source = readFileSync(
		new URL(
			"../../src/modules/repository/hooks/useRepositoryWorkbench.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
		source.slice(
			source.indexOf("const changesSelection ="),
			source.indexOf("\n\tconst changeActions ="),
		),
	);
	const files = [
		{ path: "a.rs", staged: false, status: "M", additions: 3, deletions: 1 },
	];
	const initial = {
		sidebarContent: "workingTree",
		selectedCommitHash: null as string | null,
		selectedCommitIds: [] as string[],
		selectedFile: null as { path: string } | null,
	};
	const fixture = signals.createRoot((dispose) => {
		const [panelSession, setSession] = signals.createSignal(initial);
		const [workingTreeFiles, setFiles] = signals.createSignal(files);
		const dependencies = {
			createMemo: signals.createMemo,
			panelSession,
			workingTreeFiles,
			workingTreePresentation: () => undefined,
			fileViewMode: () => "path",
			historyDetails: {
				data: { commit: null, comparison: null },
				loading: false,
				error: null,
			},
			rustProject: project,
		};
		const model = new Function(
			...Object.keys(dependencies),
			`${code}; return changesModel;`,
		)(...Object.values(dependencies));
		return { dispose, setSession, setFiles, model };
	});
	try {
		const before = fixture.model();
		expect(before.additions).toBe(3);
		fixture.setSession({ ...initial, selectedFile: { path: "a.rs" } });
		signals.flush();
		expect(fixture.model()).toBe(before);
		fixture.setFiles([{ ...files[0], additions: 7 }]);
		signals.flush();
		expect(fixture.model().additions).toBe(7);
		fixture.setSession({
			...initial,
			sidebarContent: "commit",
			selectedCommitHash: "a",
			selectedCommitIds: ["a"],
		});
		signals.flush();
		expect(fixture.model().showingWorkingTree).toBe(false);
		expect(fixture.model().historyMessage).toBe(
			"No details available for this commit",
		);
	} finally {
		fixture.dispose();
	}
});

test("graph selections survive filtering, update from fresh results, and ignore unrelated panel navigation", () => {
	const source = readFileSync(
		new URL(
			"../../src/modules/repository/hooks/useRepositoryWorkbench.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
		source.slice(
			source.indexOf("const graphSelection ="),
			source.indexOf("\n\tconst selectedGraphWorktree ="),
		) +
			source.slice(
				source.indexOf("const historicalInput ="),
				source.indexOf("\n\tconst historyDetails ="),
			),
	);
	const first = { id: "a", hash: "a", itemKind: "commit", message: "before" };
	const second = { ...first, id: "b", hash: "b" };
	const initial = {
		mainViewMode: "graph",
		selectedCommitHash: "a",
		selectedCommitIds: ["a", "b"],
		selectedFile: "",
	};
	const fixture = signals.createRoot((dispose) => {
		const [panelSession, setSession] = signals.createSignal(initial);
		const [commits, setCommits] = signals.createSignal([first, second]);
		const [graphCwd, setCwd] = signals.createSignal("/one");
		let projections = 0;
		const deps = {
			createMemo: signals.createMemo,
			panelSession,
			graphCwd,
			diffViewerProject: () => undefined,
			fileSource: () => undefined,
			rustProject: (operation: "historicalQuery", input: unknown) => {
				projections++;
				return project(operation, input);
			},
			graph: {
				get commits() {
					return commits();
				},
			},
		};
		const selected = new Function(
			...Object.keys(deps),
			`${code}; return { selectedGraph, historical };`,
		)(...Object.values(deps)) as {
			selectedGraph: () => {
				items: (typeof first)[];
				item: typeof first | null;
			};
			historical: () => { commit: { hash?: string } };
		};
		return {
			dispose,
			setSession,
			setCommits,
			setCwd,
			selected: selected.selectedGraph,
			historical: selected.historical,
			projections: () => projections,
		};
	});
	try {
		const before = fixture.selected();
		const query = fixture.historical();
		fixture.setSession({
			...initial,
			selectedCommitIds: ["a", "b"],
			selectedFile: "README.md",
		});
		signals.flush();
		expect(fixture.selected()).toBe(before);
		expect(fixture.historical()).toBe(query);
		expect(fixture.projections()).toBe(1);
		fixture.setCommits([second]);
		signals.flush();
		expect(fixture.selected().item).toBe(first);
		expect(fixture.selected().items).toEqual([first, second]);
		const refreshed = { ...first, message: "after" };
		fixture.setCommits([refreshed, second]);
		signals.flush();
		expect(fixture.selected().item).toBe(refreshed);
		fixture.setSession({
			...initial,
			selectedCommitHash: "b",
			selectedCommitIds: ["b"],
		});
		signals.flush();
		expect(fixture.selected().items).toEqual([second]);
		expect(fixture.historical().commit.hash).toBe("b");
		fixture.setCwd("/two");
		fixture.setCommits([]);
		signals.flush();
		expect(fixture.selected().items).toEqual([]);
		expect(fixture.selected().item).toBeNull();
	} finally {
		fixture.dispose();
	}
});
