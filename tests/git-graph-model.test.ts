import { describe, expect, test } from "bun:test";
import { resolveGitAuthorAvatar } from "../src/modules/repository/model/git-avatar.ts";
import {
	adjacentCommitOnBranch,
	buildGraphConnectionPath,
	buildGraphConvergencePath,
	collectReachableCommitIds,
	DEFAULT_GIT_GRAPH_HISTORY_LIMIT,
	graphVirtualRange,
	MAX_GIT_GRAPH_HISTORY_LIMIT,
	matchesGraphSearch,
	moveGraphColumn,
	nearestContainingBranches,
	nextGitGraphHistoryLimit,
	pinnedGraphColumnOrder,
} from "../src/modules/workbench/graph/model/graph-model.ts";
import {
	createInteractiveRebasePlan,
	moveInteractiveRebaseStep,
	updateInteractiveRebaseStep,
	validateInteractiveRebasePlan,
} from "../src/modules/workbench/graph/model/rebase-model.ts";

describe("Git graph presentation model", () => {
	test("collects only the selected ref's loaded ancestry", () => {
		const commits = [
			{ id: "merge", hash: "merge", parents: ["main", "feature"] },
			{ id: "feature", hash: "feature", parents: ["root"] },
			{ id: "main", hash: "main", parents: ["root"] },
			{ id: "root", hash: "root", parents: [] },
			{ id: "unrelated", hash: "unrelated", parents: [] },
		];
		expect([...collectReachableCommitIds(commits, ["feature"])]).toEqual([
			"feature",
			"root",
		]);
	});

	test("moves any visible graph column before the drop target", () => {
		expect(
			moveGraphColumn(
				["date", "refs", "graph", "message", "sha"],
				"message",
				"date",
			),
		).toEqual(["message", "date", "refs", "graph", "sha"]);
	});

	test("curves the parent lane into the commit node at its centerline", () => {
		const path = buildGraphConnectionPath({
			row: 2,
			fromCol: 0,
			toCol: 2,
			color: "#00aaff",
		});
		expect(path).toBe("M 63 80.5 L 63 66.5 A 9 9 0 0 0 54 57.5 L 27 57.5");
	});

	test("keeps duplicate parent edges separate until they converge at the node", () => {
		const path = buildGraphConvergencePath({
			row: 4,
			fromCol: 1,
			toCol: 0,
			color: "#0063f2",
		});
		expect(path).toBe("M 45 92 L 45 94.5 A 9 9 0 0 1 36 103.5 L 27 103.5");
	});

	test("mounts a bounded row window throughout a 10,000-item history", () => {
		const expectedMaximum = Math.ceil(640 / 22) + 24;
		for (const scrollTop of [0, 22, 22_000, 110_000, 219_360]) {
			const range = graphVirtualRange(10_000, scrollTop, 640, 22, 12);
			expect(range.start).toBeGreaterThanOrEqual(0);
			expect(range.end).toBeLessThanOrEqual(10_000);
			expect(range.end - range.start).toBeLessThanOrEqual(expectedMaximum);
		}
		expect(graphVirtualRange(10_000, 0, 640, 22, 12).start).toBe(0);
		expect(graphVirtualRange(10_000, 219_360, 640, 22, 12).end).toBe(10_000);
	});

	test("grows measured history pages geometrically up to a hard cap", () => {
		expect(DEFAULT_GIT_GRAPH_HISTORY_LIMIT).toBe(1_000);
		expect(nextGitGraphHistoryLimit(1_000)).toBe(2_000);
		expect(nextGitGraphHistoryLimit(2_000)).toBe(4_000);
		expect(nextGitGraphHistoryLimit(99_500)).toBe(MAX_GIT_GRAPH_HISTORY_LIMIT);
	});

	test("moves pinned branch lanes left without dropping graph columns", () => {
		expect(pinnedGraphColumnOrder(5, [3, 1, 3])).toEqual([3, 1, 0, 2, 4, 5]);
	});

	test("finds the nearest containing branch for an unlabelled commit", () => {
		const commits = [
			{ id: "feature", hash: "feature", parents: ["shared"] },
			{ id: "main", hash: "main", parents: ["shared"] },
			{ id: "shared", hash: "shared", parents: ["root"] },
			{ id: "root", hash: "root", parents: [] },
		];
		const main = {
			fullName: "refs/heads/main",
			displayName: "main",
			kind: "head" as const,
			target: "main",
		};
		const feature = {
			fullName: "refs/heads/feature",
			displayName: "feature",
			kind: "localBranch" as const,
			target: "feature",
		};
		const containing = nearestContainingBranches(commits, [feature, main]);
		expect(containing.get("shared")).toEqual(main);
		expect(containing.get("feature")).toEqual(feature);
	});

	test("moves between loaded commits on the selected containing branch", () => {
		const commits = [
			{ id: "main", hash: "main", parents: ["middle"] },
			{ id: "side", hash: "side", parents: ["root"] },
			{ id: "middle", hash: "middle", parents: ["root"] },
			{ id: "root", hash: "root", parents: [] },
		];
		expect(adjacentCommitOnBranch(commits, "middle", "main", "newer")).toBe(
			"main",
		);
		expect(adjacentCommitOnBranch(commits, "middle", "main", "older")).toBe(
			"root",
		);
	});

	test("builds and validates an ordered interactive rebase plan", () => {
		const plan = createInteractiveRebasePlan([
			{ hash: "a", message: "A", author: "Ray", date: "now" },
			{ hash: "b", message: "B", author: "Ray", date: "now" },
			{ hash: "c", message: "C", author: "Ray", date: "now" },
		]);
		const reordered = moveInteractiveRebaseStep(plan, 2, 1);
		expect(reordered.map((step) => step.hash)).toEqual(["a", "c", "b"]);
		const reworded = updateInteractiveRebaseStep(reordered, 1, {
			action: "reword",
			message: "New C",
		});
		expect(validateInteractiveRebasePlan(reworded)).toBeNull();
		expect(
			validateInteractiveRebasePlan(
				updateInteractiveRebaseStep(reworded, 0, { action: "squash" }),
			),
		).toBe("The first retained commit cannot be squashed");
	});

	test("uses GitHub profile images for noreply commit identities", async () => {
		expect(
			await resolveGitAuthorAvatar(
				"123456+Example-Author@users.noreply.github.com",
			),
		).toBe("https://github.com/example-author.png?size=64");
	});

	test("searches committer metadata and supports scoped author filters", () => {
		const commit = {
			id: "full-object-id",
			hash: "full-object-id",
			message: "Merge the renderer",
			body: "Keep the graph stable",
			author: "Feature Author",
			authorEmail: "author@example.com",
			committer: "Release Manager",
			committerEmail: "release@example.com",
			date: "now",
			authoredAt: "2026-08-31T12:00:00Z",
			committedAt: "2026-08-31T13:00:00Z",
			refs: [{ displayName: "main", fullName: "refs/heads/main" }],
		};
		expect(matchesGraphSearch(commit, "release manager")).toBe(true);
		expect(matchesGraphSearch(commit, 'committer:"release manager"')).toBe(
			true,
		);
		expect(matchesGraphSearch(commit, "author:feature ref:main")).toBe(true);
		expect(matchesGraphSearch(commit, "author:release")).toBe(false);
	});
});
