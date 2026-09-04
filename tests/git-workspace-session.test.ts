import { describe, expect, test } from "bun:test";
import {
	bindGitGraphRepository,
	dismissGitWorkspaceViewer,
	emptyGitWorkspacePanelSession,
	getGitWorkspaceSidebarContent,
	isGitWorkspaceGraphDrillIn,
	isHistoricalGitWorkspaceDiff,
	normalizeGitWorkspacePanelSession,
	openGitCommitFileDiff,
	openGitGraph,
	openGitWorkingTreeFileDiff,
	reconcileGitGraphSelection,
	serializeGitWorkspacePanelSession,
	updateGitGraphSelection,
} from "../src/modules/workbench/model/workbench-model.ts";

describe("Git workspace panel session", () => {
	test("normalizes persisted graph state and strips transient file payloads", () => {
		const restored = normalizeGitWorkspacePanelSession(
			{
				fileViewerOpen: true,
				fileRequest: { path: "src/app.tsx", token: 1 },
				selectedFile: { path: "src/app.tsx", staged: false },
				selectedCommitHash: "commit-b",
				selectedCommitIds: ["commit-a", 42, "commit-b"],
				mainViewMode: "graph",
				detachedFilePanels: [
					{
						id: "panel-1",
						cwd: "/repo",
						path: "src/app.tsx",
						initialFile: { content: "transient" },
					},
					{ id: 42 },
				],
			},
			1234,
		);
		expect(restored.mainViewMode).toBe("graph");
		expect(restored.diffContext).toBeNull();
		expect(restored.selectedCommitIds).toEqual(["commit-a", "commit-b"]);
		expect(restored.fileRequest).toEqual({ path: "src/app.tsx", token: 1234 });
		expect(restored.detachedFilePanels).toHaveLength(1);
		expect(
			serializeGitWorkspacePanelSession(restored).detachedFilePanels,
		).toEqual([{ id: "panel-1", cwd: "/repo", path: "src/app.tsx" }]);
	});

	test("preserves graph selection while opening and returning from a commit diff", () => {
		const selected = updateGitGraphSelection(
			emptyGitWorkspacePanelSession(),
			"commit-b",
			["commit-a", "commit-b", "commit-c"],
		);
		const diff = openGitCommitFileDiff(
			selected,
			"/repo",
			"src/app.tsx",
			"commit-b",
			"commit-c",
		);
		expect(diff.mainViewMode).toBe("diff");
		expect(diff.diffContext).toBe("commit");
		expect(isGitWorkspaceGraphDrillIn(diff)).toBe(true);
		expect(isHistoricalGitWorkspaceDiff(diff)).toBe(true);
		expect(getGitWorkspaceSidebarContent(diff, false)).toBe("history");
		expect(diff.selectedFileCommitHash).toBe("commit-b");
		expect(diff.selectedCommitHash).toBe("commit-b");

		const graph = dismissGitWorkspaceViewer(diff);
		expect(graph.mainViewMode).toBe("graph");
		expect(graph.diffContext).toBeNull();
		expect(graph.selectedCommitHash).toBe("commit-b");
		expect(graph.selectedFile?.path).toBe("src/app.tsx");
		expect(graph.focusedAuxiliaryPanel).toEqual({
			id: "workspace-diff-viewer",
			cwd: "/repo",
		});

		const closed = dismissGitWorkspaceViewer(graph);
		expect(closed.diffViewerCwd).toBeNull();
		expect(closed.selectedCommitHash).toBeNull();
		expect(closed.selectedFile).toBeNull();
	});

	test("keeps a graph WIP drill-in in working-tree context and returns to graph", () => {
		const selectedWip = {
			...openGitGraph(emptyGitWorkspacePanelSession(), "/repo"),
			selectedCommitHash: "wip",
			selectedCommitIds: ["wip"],
		};
		const diff = openGitWorkingTreeFileDiff(selectedWip, "/repo", {
			path: "src/app.tsx",
			staged: false,
		});
		expect(diff.diffContext).toBe("graphWorkingTree");
		expect(isGitWorkspaceGraphDrillIn(diff)).toBe(true);
		expect(isHistoricalGitWorkspaceDiff(diff)).toBe(false);
		expect(getGitWorkspaceSidebarContent(diff, false)).toBe("workingTree");

		const nextDiff = openGitWorkingTreeFileDiff(diff, "/repo", {
			path: "src/next.tsx",
			staged: true,
		});
		expect(nextDiff.diffContext).toBe("graphWorkingTree");
		expect(getGitWorkspaceSidebarContent(nextDiff, false)).toBe("workingTree");

		const graph = dismissGitWorkspaceViewer(nextDiff);
		expect(graph.mainViewMode).toBe("graph");
		expect(graph.selectedCommitHash).toBe("wip");
		expect(graph.diffViewerCwd).toBe("/repo");
	});

	test("closes a working-tree diff opened outside the graph", () => {
		const diff = openGitWorkingTreeFileDiff(
			emptyGitWorkspacePanelSession(),
			"/repo",
			{ path: "src/app.tsx", staged: true },
		);
		expect(diff.diffContext).toBe("workingTree");
		expect(isGitWorkspaceGraphDrillIn(diff)).toBe(false);
		expect(getGitWorkspaceSidebarContent(diff, false)).toBe("workingTree");
		expect(dismissGitWorkspaceViewer(diff).diffViewerCwd).toBeNull();
	});

	test("binds an open graph to a clean chat repository without leaking the previous selection", () => {
		const previous = {
			...openGitGraph(emptyGitWorkspacePanelSession(), "/repo-with-changes"),
			selectedCommitHash: "old-commit",
			selectedCommitIds: ["old-commit"],
			selectedCommitParent: "old-parent",
			selectedFile: { path: "src/old.ts", staged: false },
		};
		const rebound = bindGitGraphRepository(previous, "/clean-repo");
		expect(rebound.diffViewerCwd).toBe("/clean-repo");
		expect(rebound.focusedAuxiliaryPanel).toBeNull();
		expect(rebound.selectedCommitHash).toBeNull();
		expect(rebound.selectedCommitIds).toEqual([]);
		expect(rebound.selectedCommitParent).toBeNull();
		expect(rebound.selectedFile).toBeNull();
		expect(rebound.mainViewMode).toBe("graph");
	});

	test("supports additive and contiguous range selections", () => {
		const order = ["a", "b", "c", "d"];
		const base = updateGitGraphSelection(
			emptyGitWorkspacePanelSession(),
			"b",
			order,
		);
		const range = updateGitGraphSelection(base, "d", order, {
			additive: false,
			range: true,
		});
		expect(range.selectedCommitIds).toEqual(["b", "c", "d"]);
		const removed = updateGitGraphSelection(range, "c", order, {
			additive: true,
			range: false,
		});
		expect(removed.selectedCommitIds).toEqual(["b", "d"]);
		expect(removed.selectedCommitHash).toBe("d");
	});

	test("keeps visible identities and announces a deterministic fallback", () => {
		const current = {
			...emptyGitWorkspacePanelSession(),
			selectedCommitHash: "removed",
			selectedCommitIds: ["visible", "removed"],
			selectedCommitParent: "parent",
		};
		const result = reconcileGitGraphSelection(current, [
			{ id: "first", message: "First commit" },
			{ id: "visible", message: "Visible commit" },
		]);
		expect(result.session.selectedCommitHash).toBe("visible");
		expect(result.session.selectedCommitIds).toEqual(["visible"]);
		expect(result.session.selectedCommitParent).toBeNull();
		expect(result.announcement).toContain("Selected First commit");
	});
});
