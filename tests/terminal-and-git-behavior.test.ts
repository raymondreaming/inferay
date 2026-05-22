import { describe, expect, test } from "bun:test";
import {
	appendPaneToGroup,
	createDefaultAgentChatGroup,
	getPaneTitle,
	getStatusInfo,
	migrateGroup,
	type GroupId,
	type PaneId,
	type TerminalGroupModel,
	type TerminalPaneModel,
} from "../src/features/terminal/terminal-utils.ts";
import { summarizeHunkDiff } from "../src/features/git/useGitDiff.ts";
import {
	isUnstagedTrackedChange,
	isUntrackedChange,
	orderGitFiles,
	orderProjectGitFiles,
} from "../src/lib/git-file-utils.ts";
import { normalizeNumstatPath } from "../src/server/services/git.ts";

const pane = (
	id: string,
	overrides: Partial<TerminalPaneModel> = {}
): TerminalPaneModel => ({
	id: id as PaneId,
	title: id,
	agentKind: "terminal",
	isClaude: false,
	paneType: "terminal",
	...overrides,
});

describe("terminal state and git change behavior", () => {
	/*
	 * This protects saved terminal state migration across app versions. Older
	 * panes may only have paneType/isClaude fields, and selectedPaneId may point
	 * at a removed pane; migration must infer the agent kind and choose a valid
	 * selected pane so restored workspaces open cleanly.
	 */
	test("migrates terminal groups with valid selection and inferred agent metadata", () => {
		const migrated = migrateGroup({
			id: "group-1" as GroupId,
			name: "Main",
			selectedPaneId: "missing" as PaneId,
			panes: [
				pane("p1", {
					agentKind: undefined as unknown as TerminalPaneModel["agentKind"],
					paneType: "codex",
				}),
				pane("p2", {
					agentKind: undefined as unknown as TerminalPaneModel["agentKind"],
					isClaude: true,
					paneType: undefined,
				}),
			],
		});

		expect(migrated.selectedPaneId).toBe("p1");
		expect(migrated.columns).toBe(3);
		expect(migrated.rows).toBe(2);
		expect(migrated.panes.map((item) => item.agentKind)).toEqual([
			"codex",
			"claude",
		]);
		expect(migrated.panes.map((item) => item.isClaude)).toEqual([false, true]);
	});

	test("creates the default workspace as a six-pane agent chat grid", () => {
		const group = createDefaultAgentChatGroup();

		expect(group.columns).toBe(3);
		expect(group.rows).toBe(2);
		expect(group.panes).toHaveLength(6);
		expect(group.selectedPaneId).toBe(group.panes[0]?.id);
		expect(group.panes.every((item) => item.agentKind === "codex")).toBe(true);
		expect(group.panes.every((item) => item.pendingCwd)).toBe(true);
	});

	/*
	 * This protects core terminal tab/group data operations. Adding a pane should
	 * only affect the selected group and should atomically select the newly added
	 * pane, while title generation should prefer the workspace directory name
	 * over generic agent labels.
	 */
	test("appends panes only to the selected group and derives workspace titles", () => {
		const nextPane = pane("p2", { cwd: "/Users/test/project-a" });
		const group: TerminalGroupModel = {
			id: "group-1" as GroupId,
			name: "Main",
			panes: [pane("p1")],
			selectedPaneId: "p1" as PaneId,
			columns: 2,
			rows: 1,
		};

		expect(appendPaneToGroup("group-1", nextPane, group)).toEqual({
			...group,
			panes: [pane("p1"), nextPane],
			selectedPaneId: "p2",
		});
		expect(appendPaneToGroup("other", nextPane, group)).toBe(group);
		expect(getPaneTitle("codex", "/Users/test/project-a")).toBe("project-a");
		expect(getPaneTitle("claude")).toBe("Claude");
	});

	/*
	 * This protects status mapping used by terminal and agent surfaces. Tool
	 * statuses carry the tool name through the UI, active statuses remain marked
	 * active, and unknown statuses degrade into an inactive readable label.
	 */
	test("maps terminal status strings into stable status info", () => {
		expect(getStatusInfo("tool:apply_patch")).toEqual(
			expect.objectContaining({
				label: "Running apply_patch",
				toolName: "apply_patch",
				isActive: true,
				iconType: "wrench",
			})
		);
		expect(getStatusInfo("thinking")).toEqual(
			expect.objectContaining({ label: "Thinking...", isActive: true })
		);
		expect(getStatusInfo("queued")).toEqual(
			expect.objectContaining({ label: "queued", isActive: false })
		);
	});

	/*
	 * This protects the Git changes ordering used by review and staging flows.
	 * Unstaged files should stay ahead of staged files, untracked files are
	 * distinct from tracked modifications, and null project aggregates should
	 * produce an empty list instead of forcing UI callers to branch.
	 */
	test("orders and classifies git files for change review flows", () => {
		const files = [
			{ path: "staged.ts", staged: true, status: "M" },
			{ path: "modified.ts", staged: false, status: "M" },
			{ path: "new.ts", staged: false, status: "?" },
		];

		expect(orderGitFiles(files).map((file) => file.path)).toEqual([
			"modified.ts",
			"new.ts",
			"staged.ts",
		]);
		expect(orderProjectGitFiles({ files }).map((file) => file.path)).toEqual([
			"modified.ts",
			"new.ts",
			"staged.ts",
		]);
		expect(orderProjectGitFiles(null)).toEqual([]);
		expect(isUntrackedChange(files[2]!)).toBe(true);
		expect(isUnstagedTrackedChange(files[1]!)).toBe(true);
		expect(isUnstagedTrackedChange(files[2]!)).toBe(false);
	});

	test("summarizes deletion-only diffs as navigable hunks", () => {
		expect(
			summarizeHunkDiff({
				oldLines: [
					{ number: 1, content: "remove me", type: "remove" },
					{ number: 2, content: "keep", type: "context" },
				],
				newLines: [
					{ number: null, content: "", type: "spacer" },
					{ number: 1, content: "keep", type: "context" },
				],
				isBinary: false,
				isNew: false,
			})
		).toEqual({ added: 0, removed: 1, hunks: 1, lines: 2 });
	});

	test("normalizes git numstat rename paths for sidebar diff stats", () => {
		expect(normalizeNumstatPath("src/old.ts => src/new.ts")).toBe("src/new.ts");
		expect(normalizeNumstatPath("src/{old => new}/file.ts")).toBe(
			"src/new/file.ts"
		);
	});
});
