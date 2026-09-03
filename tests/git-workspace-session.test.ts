import { describe, expect, test } from "bun:test";
import {
	bindGitGraphRepository,
	emptyGitWorkspacePanelSession,
	normalizeGitWorkspacePanelSession,
	openGitCommitFileDiff,
	openGitGraph,
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
		expect(diff.selectedFileCommitHash).toBe("commit-b");
		expect(diff.selectedCommitHash).toBe("commit-b");

		const graph = openGitGraph(diff, "/repo");
		expect(graph.mainViewMode).toBe("graph");
		expect(graph.selectedCommitHash).toBe("commit-b");
		expect(graph.selectedFile?.path).toBe("src/app.tsx");
		expect(graph.focusedAuxiliaryPanel).toEqual({
			id: "workspace-diff-viewer",
			cwd: "/repo",
		});
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
