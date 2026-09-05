import { describe, expect, test } from "bun:test";
import {
	getRepositoryWorkspaceTarget,
	getVisibleRepositoryEntries,
	projectRepositoryWorkspaces,
} from "../src/modules/workspace/model/repository-workspaces.ts";
import { resolveCreateAgentChatCwd } from "../src/modules/workspace/model/workspace-events.ts";
import type {
	AgentGroupModel,
	AgentPaneModel,
} from "../src/modules/workspace/model/workspace-model.ts";

function pane(id: string, cwd?: string): AgentPaneModel {
	return {
		id: id as AgentPaneModel["id"],
		title: id,
		agentKind: "codex",

		cwd,
	};
}

function group(
	id: string,
	panes: AgentPaneModel[],
	selectedPaneId: string,
): AgentGroupModel {
	return {
		id: id as AgentGroupModel["id"],
		name: id,
		panes,
		selectedPaneId: selectedPaneId as AgentGroupModel["selectedPaneId"],
		columns: 2,
		rows: 2,
	};
}

describe("repository workspace projection", () => {
	test("only inherits the active repository for a regular new chat", () => {
		expect(
			resolveCreateAgentChatCwd("active-repository", "/work/inferay"),
		).toBe("/work/inferay");
		expect(resolveCreateAgentChatCwd("new-repository", "/work/inferay")).toBe(
			undefined,
		);
	});

	test("deduplicates repository paths and scopes chats to the selected pane", () => {
		const groups = [
			group("layout-a", [pane("a", "/work/inferay"), pane("b")], "a"),
			group(
				"layout-b",
				[pane("c", "/work/inferay/"), pane("d", "/work/another")],
				"d",
			),
		];
		const projection = projectRepositoryWorkspaces(groups, "layout-a");

		expect(projection.workspaces.map((workspace) => workspace.name)).toEqual([
			"inferay",
			"another",
		]);
		expect(projection.activeWorkspace?.cwd).toBe("/work/inferay");
		expect(
			projection.activeWorkspace?.entries.map((entry) => entry.pane.id),
		).toEqual(["a", "c"]);
		expect(projection.unassignedEntries.map((entry) => entry.pane.id)).toEqual([
			"b",
		]);
		expect(
			getVisibleRepositoryEntries(projection, "layout-b").map(
				(entry) => entry.pane.id,
			),
		).toEqual(["c"]);
	});

	test("keeps repository switching in the current layout group when possible", () => {
		const groups = [
			group(
				"layout-a",
				[pane("a", "/work/inferay"), pane("b", "/work/another")],
				"a",
			),
			group("layout-b", [pane("c", "/work/another")], "c"),
		];
		const projection = projectRepositoryWorkspaces(groups, "layout-a");
		const another = projection.workspaces.find(
			(workspace) => workspace.cwd === "/work/another",
		);

		expect(another).toBeDefined();
		expect(
			getRepositoryWorkspaceTarget(another!, groups, "layout-a")?.pane.id,
		).toBe("b");
	});
});
