import { expect, test } from "bun:test";
import { createWorkspaceSession } from "@workspace/hooks/useWorkspaceState.tsx";

// Exercise the production queue through its injected persistence port.
function model(send: (path: string, body: any) => Promise<any>) {
	const session = createWorkspaceSession({
		initialize: async () =>
			(await send("/api/agent/state/initialize", {})).state,
		load: async () => (await send("/api/agent/state", {})).state,
		save: async (action) =>
			(await send("/api/agent/state/workspace-action", { action })).state,
	});
	return {
		initializeAgentState: session.initialize,
		mutateAgentWorkspaceState: session.mutate,
	};
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
			state = {
				...state,
				selectedGroupId: "g",
				groups: state.groups.map((group) =>
					group.id === "g"
						? { ...group, selectedPaneId: body.action.paneId }
						: group,
				),
			};
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
	expect(selected?.groups[0]?.selectedPaneId).toBe("a");
});
