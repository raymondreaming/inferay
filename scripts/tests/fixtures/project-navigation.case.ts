import { expect, spyOn, test } from "bun:test";
import type { Workspace } from "@contracts";
import { createRoot, flush } from "solid-js";
import {
	openProjectRepository,
	projects,
	refreshProjects,
	selectProject,
	showProjectView,
	toggleProjectRepository,
} from "../../../src/modules/workspace/hooks/useProjects.tsx";
import {
	configureWorkspaceState,
	initializeAgentState,
	mutateAgentWorkspaceState,
	useWorkspaceState,
} from "../../../src/modules/workspace/hooks/useWorkspaceState.tsx";

test("project tabs restore their own section and repository", async () => {
	let repositoryPaths: Record<string, string> = {
		first: "/first",
		second: "/second",
	};
	let delayed: Promise<Response> | undefined;
	const fetch = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async () =>
				delayed ??
				Response.json({
					root: "/profile",
					conversationProjects: {
						a1: "navigation-a",
						a2: "navigation-a",
						b1: "navigation-b",
					},
					history: {
						runs: [],
						artifacts: [],
						effects: [],
						hasMoreRuns: false,
						nextRunCursor: null,
					},
					catalog: {
						projects: [],
						resources: [],
						tools: [],
						skills: [],
						automations: [],
						issues: [],
						plugins: [],
						repositoryPaths,
					},
				}),
			{ preconnect: globalThis.fetch.preconnect },
		),
	);
	let state: Workspace = {
		groups: ["a1", "a2", "b1"].map((id) => ({
			id: `group-${id}`,
			name: id,
			selectedPaneId: id,
			columns: 1,
			rows: 1,
			panes: [
				{
					id,
					title: id,
					agentKind: "claude",
					pendingCwd: false,
					referencePaths: [],
				},
			],
		})),
		selectedGroupId: "group-a1",
	};
	configureWorkspaceState({
		initialize: async () => state,
		load: async () => state,
		save: async (action) => {
			if (action.type === "selectPane")
				state = {
					...state,
					selectedGroupId: state.groups.find((g) =>
						g.panes.some((p) => p.id === action.paneId),
					)!.id,
				};
			return state;
		},
	});
	await initializeAgentState();
	flush();
	let dispose = () => {};
	const [workspace] = createRoot((cleanup) => {
		dispose = cleanup;
		return useWorkspaceState(() => false);
	});
	const select = async (id: string) => {
		const pending = selectProject(id);
		flush();
		await pending;
		flush();
	};
	const mutate = async (
		action: Parameters<typeof mutateAgentWorkspaceState>[0],
	) => {
		const pending = mutateAgentWorkspaceState(action);
		flush();
		await pending;
		flush();
	};

	try {
		expect(workspace().entries.map((entry) => entry.pane.id)).toEqual([
			"a1",
			"a2",
			"b1",
		]);
		for (const entry of workspace().entries)
			expect(entry.pane).toBe(
				workspace().groups.find((group) => group.id === entry.groupId)!
					.panes[0],
			);
		await select("navigation-a");
		expect(workspace().entries.map((entry) => entry.pane.id)).toEqual([
			"a1",
			"a2",
		]);
		expect(projects.view()).toBe("chat");
		showProjectView("automations");
		flush();
		await select("navigation-b");
		expect(projects.view()).toBe("chat");
		await select("navigation-a");
		expect(projects.view()).toBe("automations");
		await select("navigation-a");
		expect(projects.view()).toBe("automations");
		openProjectRepository("/second");
		flush();
		expect(projects.view()).toBe("automations");
		await select("navigation-b");
		expect(projects.repositoryOpen()).toBe(false);
		expect(projects.view()).toBe("chat");
		await select("navigation-a");
		expect(projects.view()).toBe("automations");
		expect(projects.repositoryOpen()).toBe(true);
		expect(projects.repositoryPath()).toBe("/second");
		expect(projects.error()).toBe("");
		showProjectView("chat");
		flush();
		await mutate({
			type: "selectPane",
			paneId: "a2",
		});
		await select("navigation-b");
		expect(workspace().selectedGroupId).toBe("group-b1");
		await mutate({
			type: "selectPane",
			paneId: "b1",
		});
		await select("navigation-a");
		expect(projects.view()).toBe("chat");
		expect(workspace().selectedGroupId).toBe("group-a2");
		expect(
			workspace().groups.find((g) => g.id === workspace().selectedGroupId)
				?.selectedPaneId,
		).toBe("a2");
		toggleProjectRepository();
		flush();
		repositoryPaths = { first: "/first" };
		await refreshProjects();
		flush();
		expect(projects.repositoryPath()).toBe("/first");
		expect(projects.repositoryOpen()).toBe(false);
		repositoryPaths = {};
		await refreshProjects();
		flush();
		expect(projects.repositoryPath()).toBeNull();
		const old = Promise.withResolvers<Response>();
		delayed = old.promise;
		const oldRefresh = refreshProjects();
		delayed = undefined;
		repositoryPaths = { other: "/other" };
		await select("navigation-b");
		old.resolve(Response.json({ invalid: "outdated response" }));
		await oldRefresh;
		flush();
		expect(projects.repositoryPath()).toBe("/other");
		expect(projects.error()).toBe("");
	} finally {
		dispose();
		fetch.mockRestore();
	}
});
