import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createStore, reconcile } from "@solidjs/signals";
import { project } from "../../src/shared/lib/native.tsx";

// Exercise the production queue without mounting the Solid runtime.
function model(send: (path: string, body: any) => Promise<any>) {
	const source = readFileSync(
		new URL(
			"../../src/modules/workspace/hooks/useWorkspaceState.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const declarations = source
		.slice(
			source.indexOf("let snapshot:"),
			source.indexOf("export const changePaneAgentKind"),
		)
		.replaceAll("export ", "");
	const code = new Bun.Transpiler({ loader: "ts" }).transformSync(declarations);
	return new Function(
		"postJson",
		"rustProject",
		"noop",
		"traceUi",
		"createStore",
		"reconcile",
		`${code}\nreturn { initializeAgentState, mutateAgentWorkspaceState };`,
	)(
		send,
		project,
		() => {},
		() => {},
		createStore,
		reconcile,
	);
}
function initialState() {
	return {
		groups: [
			{
				id: "g",
				name: "Default",
				selectedPaneId: "a",
				panes: [
					{
						id: "a",
						title: "Claude",
						agentKind: "claude",
						cwd: "/repo",
						referencePaths: [],
					},
				],
				columns: 1,
				rows: 1,
			},
		],
		selectedGroupId: "g",
		themeId: "default",
		fontSize: 13,
		fontFamily: "SF Mono",
		opacity: 1,
		repositories: {
			workspaces: [],
			unassignedEntries: [],
			activePath: "/repo",
			activeWorkspace: null,
			visibleEntries: [],
		},
	};
}

test("repeated selection does not queue persistence ahead of new chat creation", async () => {
	const state = initialState();
	const sent: string[] = [];
	const workspace = model(async (path, body) => {
		if (!path.endsWith("/initialize")) sent.push(body.action.type);
		return { state };
	});
	await workspace.initializeAgentState();
	const selections = Array.from({ length: 12 }, () =>
		workspace.mutateAgentWorkspaceState({
			type: "selectPane",
			groupId: "g",
			paneId: "a",
		}),
	);
	await workspace.mutateAgentWorkspaceState({ type: "addPane", groupId: "g" });
	await Promise.all(selections);
	expect(sent).toEqual(["addPane"]);
});

test("selection after queued creation is preserved even when it matches the old pane", async () => {
	let state = initialState();
	const sent: string[] = [];
	const created = Promise.withResolvers<void>();
	const started = Promise.withResolvers<void>();
	const workspace = model(async (path, body) => {
		if (path.endsWith("/initialize")) return { state };
		sent.push(body.action.type);
		if (body.action.type === "addPane") {
			started.resolve();
			await created.promise;
			state = {
				...state,
				groups: [
					{
						...state.groups[0]!,
						selectedPaneId: "new",
						panes: [
							...state.groups[0]!.panes,
							{ ...state.groups[0]!.panes[0]!, id: "new" },
						],
					},
				],
			};
		} else {
			state = project("workspaceSelection", {
				state,
				groupId: "g",
				paneId: body.action.paneId,
			});
		}
		return { state };
	});
	await workspace.initializeAgentState();
	const adding = workspace.mutateAgentWorkspaceState({
		type: "addPane",
		groupId: "g",
	});
	await started.promise;
	const selecting = workspace.mutateAgentWorkspaceState({
		type: "selectPane",
		groupId: "g",
		paneId: "a",
	});
	created.resolve();
	await adding;
	const selected = await selecting;
	expect(sent).toEqual(["addPane", "selectPane"]);
	expect(selected.groups[0].selectedPaneId).toBe("a");
});
