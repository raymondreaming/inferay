import { JSDOM } from "jsdom";
import { createRoot, useState } from "octane";
import { describe, expect, test, vi } from "vitest";
import type { GraphNode, GraphRow } from "../src/features/git/useGitGraph.tsx";
import { stylexTestTypes } from "./stylex-test-mock.ts";

const mock = Object.assign(vi.fn, {
	module: (path: string, factory: () => unknown) => vi.doMock(path, factory),
});

mock.module("@octanejs/stylex", () => ({
	create: <T extends Record<string, unknown>>(styles: T) => styles,
	createTheme: (_vars: unknown, values: unknown) => values,
	defineConsts: <T extends Record<string, string>>(values: T) => values,
	defineVars: <T extends Record<string, string>>(values: T) => values,
	types: stylexTestTypes,
	keyframes: () => "test-keyframes",
	props: () => ({ className: "" }),
}));

function graphCommit(index: number): GraphNode {
	const hash = index.toString(16).padStart(40, "0");
	return {
		id: hash,
		itemKind: "commit",
		hash,
		message: `Commit ${index}`,
		body: index % 2 ? `Description ${index}` : "",
		author: "Graph Author",
		authorEmail: "graph-author@users.noreply.github.com",
		committer: "Graph Author",
		committerEmail: "graph-author@users.noreply.github.com",
		date: "08/31/2026 @ 12:00 PM",
		authoredAt: "2026-08-31T11:00:00-05:00",
		committedAt: "2026-08-31T12:00:00-05:00",
		parents:
			index === 9_999 ? [] : [(index + 1).toString(16).padStart(40, "0")],
		refs:
			index === 0
				? [
						{
							fullName: "refs/heads/main",
							displayName: "main",
							kind: "head",
							target: hash,
							isHead: true,
						},
						{
							fullName: "refs/remotes/origin/main",
							displayName: "origin/main",
							kind: "remoteBranch",
							target: hash,
							remoteName: "origin",
							isHead: false,
						},
						{
							fullName: "refs/remotes/origin/release",
							displayName: "origin/release",
							kind: "remoteBranch",
							target: hash,
							remoteName: "origin",
							isHead: false,
						},
						{
							fullName: "refs/tags/v1.2.3",
							displayName: "v1.2.3",
							kind: "tag",
							target: hash,
							isHead: false,
						},
					]
				: [],
		column: 0,
		color: "#22b8cf",
	};
}

function setupDom() {
	const dom = new JSDOM('<div id="root"></div>', {
		pretendToBeVisual: true,
		url: "http://localhost/#/agent",
	});
	class TestResizeObserver {
		observe() {}
		disconnect() {}
	}
	Object.defineProperties(globalThis, {
		window: { configurable: true, value: dom.window },
		document: { configurable: true, value: dom.window.document },
		navigator: { configurable: true, value: dom.window.navigator },
		localStorage: { configurable: true, value: dom.window.localStorage },
		Element: { configurable: true, value: dom.window.Element },
		HTMLElement: { configurable: true, value: dom.window.HTMLElement },
		SVGElement: { configurable: true, value: dom.window.SVGElement },
		Node: { configurable: true, value: dom.window.Node },
		MouseEvent: { configurable: true, value: dom.window.MouseEvent },
		KeyboardEvent: { configurable: true, value: dom.window.KeyboardEvent },
		PointerEvent: { configurable: true, value: dom.window.MouseEvent },
		MutationObserver: {
			configurable: true,
			value: dom.window.MutationObserver,
		},
		getComputedStyle: {
			configurable: true,
			value: dom.window.getComputedStyle.bind(dom.window),
		},
		ResizeObserver: { configurable: true, value: TestResizeObserver },
	});
	Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", {
		configurable: true,
		get: () => 640,
	});
	Object.defineProperty(dom.window.HTMLElement.prototype, "scrollTo", {
		configurable: true,
		value(this: HTMLElement, options: ScrollToOptions) {
			if (typeof options.top === "number") this.scrollTop = options.top;
			if (typeof options.left === "number") this.scrollLeft = options.left;
		},
	});
	const rootElement = dom.window.document.getElementById("root");
	if (!rootElement) throw new Error("Missing root element");
	return { dom, root: createRoot(rootElement), rootElement };
}

describe("Git commit graph renderer", () => {
	test("keeps a 10,000-commit graph virtualized and selects by stable identity", async () => {
		const { CommitGraph } = await import(
			"../src/components/git/CommitGraph.tsx"
		);
		const commits = Array.from({ length: 10_000 }, (_, index) =>
			graphCommit(index),
		);
		commits[1]!.parents.push("f".repeat(40));
		const rows: GraphRow[] = commits.map((_, row) => ({
			row,
			rails: [
				{
					column: 0,
					color: "#22b8cf",
					startsAtNode: row === 0,
					endsAtNode: row === 2,
				},
			],
			transitions: [],
			convergences:
				row === 1
					? [
							{
								fromColumn: 1,
								toColumn: 0,
								color: "#0063f2",
							},
						]
					: [],
			truncatedEdges: [],
		}));
		const { dom, root, rootElement } = setupDom();
		const onCheckoutRef = vi.fn();
		function Harness() {
			const [selected, setSelected] = useState(commits[0]!.id);
			return (
				<CommitGraph
					commits={commits}
					rows={rows}
					selectedHash={selected}
					onSelect={setSelected}
					onCheckoutRef={onCheckoutRef}
					repositoryKey="/fixture/repository"
					embedded
				/>
			);
		}

		try {
			root.render(<Harness />);
			await new Promise((resolve) => setTimeout(resolve, 30));
			const graph = rootElement.querySelector('[role="listbox"]');
			expect(graph).toBeTruthy();
			expect(
				rootElement.querySelector('[data-graph-convergence="true"]'),
			).toBeTruthy();
			expect(
				rootElement.querySelector('[data-graph-merge-node="true"]'),
			).toBeTruthy();
			const startingRail = rootElement.querySelector(
				'[data-graph-rail="true"][data-graph-row="0"]',
			);
			expect(startingRail?.getAttribute("y1")).toBe("11.5");
			expect(startingRail?.getAttribute("y2")).toBe("23");
			const endingRail = rootElement.querySelector(
				'[data-graph-rail="true"][data-graph-row="2"]',
			);
			expect(endingRail?.getAttribute("y1")).toBe("46");
			expect(endingRail?.getAttribute("y2")).toBe("57.5");
			expect(
				rootElement.querySelectorAll('[role="option"]').length,
			).toBeLessThan(60);
			expect(rootElement.textContent).toContain("main");
			expect(rootElement.textContent).toContain("+2");
			expect(rootElement.textContent).not.toContain("release");
			const branchBadge = rootElement.querySelector(
				'[role="button"][title^="main"]',
			);
			(branchBadge as HTMLElement | null)?.focus();
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(rootElement.textContent).toContain("release");
			expect(rootElement.textContent).not.toContain("origin/release");
			expect(
				Array.from(
					rootElement.querySelectorAll('[data-ref-kind="remoteBranch"]'),
				).some((badge) => badge.textContent === "release"),
			).toBe(true);
			expect(rootElement.textContent).toContain("v1.2.3");
			expect(rootElement.textContent).toContain("08/31/2026 @ 12:00 PM");
			branchBadge?.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					bubbles: true,
					key: "Enter",
				}),
			);
			expect(onCheckoutRef).toHaveBeenCalledWith("main");

			graph!.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					bubbles: true,
					key: "ArrowDown",
				}),
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(
				rootElement
					.querySelector(`[data-graph-item="${commits[1]!.id}"]`)
					?.getAttribute("aria-selected"),
			).toBe("true");

			const resizeDate = rootElement.querySelector(
				'button[aria-label="Resize date column"]',
			);
			const dateHeader = Array.from(rootElement.querySelectorAll("div")).find(
				(element) => element.textContent === "Commit date / time",
			);
			resizeDate?.dispatchEvent(
				new dom.window.MouseEvent("pointerdown", {
					bubbles: true,
					button: 0,
					clientX: 100,
				}),
			);
			dom.window.dispatchEvent(
				new dom.window.MouseEvent("pointermove", {
					bubbles: true,
					clientX: 150,
				}),
			);
			dom.window.dispatchEvent(
				new dom.window.MouseEvent("pointerup", { bubbles: true }),
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect((dateHeader as HTMLElement | undefined)?.style.width).toBe(
				"182px",
			);

			const messageHeader = Array.from(
				rootElement.querySelectorAll("div"),
			).find((element) => element.textContent === "Commit message");
			const dragValues = new Map<string, string>();
			const dataTransfer = {
				setData(type: string, value: string) {
					dragValues.set(type, value);
				},
				getData(type: string) {
					return dragValues.get(type) ?? "";
				},
				get types() {
					return [...dragValues.keys()];
				},
			};
			const dragStart = new dom.window.Event("dragstart", {
				bubbles: true,
				cancelable: true,
			});
			Object.defineProperty(dragStart, "dataTransfer", { value: dataTransfer });
			messageHeader?.dispatchEvent(dragStart);
			const drop = new dom.window.Event("drop", {
				bubbles: true,
				cancelable: true,
			});
			Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
			dateHeader?.dispatchEvent(drop);
			await new Promise((resolve) => setTimeout(resolve, 20));
			const reorderedHeaders = Array.from(rootElement.querySelectorAll("div"))
				.map((element) => element.textContent)
				.filter((text) =>
					[
						"Commit date / time",
						"Branch / tag",
						"Graph",
						"Commit message",
						"SHA",
					].includes(text ?? ""),
				);
			expect(reorderedHeaders.slice(0, 5)).toEqual([
				"Commit message",
				"Commit date / time",
				"Branch / tag",
				"Graph",
				"SHA",
			]);
			rootElement
				.querySelector('button[aria-label="Graph columns and search"]')
				?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
			await new Promise((resolve) => setTimeout(resolve, 20));
			const authorToggle = Array.from(
				rootElement.querySelectorAll("button"),
			).find((button) => button.textContent?.includes("AuthorOff"));
			authorToggle?.dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true }),
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(rootElement.textContent).toContain("Graph Author");
			const storedPreferences = JSON.parse(
				dom.window.localStorage.getItem(
					"commit-graph-columns-v11:/fixture/repository",
				) ?? "{}",
			) as {
				columns?: { author?: boolean };
				widths?: { date?: number };
				order?: string[];
			};
			expect(storedPreferences.columns?.author).toBe(true);
			expect(storedPreferences.widths?.date).toBe(182);
			expect(storedPreferences.order?.[0]).toBe("message");

			const targetIndex = 5_000;
			const target = commits[targetIndex]!;
			(graph as HTMLElement).scrollTop = targetIndex * 23;
			graph!.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
			await new Promise((resolve) => setTimeout(resolve, 30));
			const targetRow = rootElement.querySelector(
				`[data-graph-item="${target.id}"]`,
			);
			expect(targetRow).toBeTruthy();
			targetRow!.dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true }),
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(
				rootElement
					.querySelector(`[data-graph-item="${target.id}"]`)
					?.getAttribute("aria-selected"),
			).toBe("true");
			expect(
				rootElement.querySelectorAll('[role="option"]').length,
			).toBeLessThan(60);
		} finally {
			root.unmount();
		}
	});

	test("renders GitKraken-style commit identity and opens a historical file", async () => {
		const { ChangeFileSidebar } = await import(
			"../src/components/git/ChangeFileSidebar.tsx"
		);
		const { dom, root, rootElement } = setupDom();
		const onSelectCommitFile = vi.fn();
		const onOpenGraph = vi.fn();
		const hash = "18ed4a4be8a2c41826f28342e0873e1509c9bb4e";
		try {
			root.render(
				<ChangeFileSidebar
					cwd="/fixture/repository"
					fileViewMode="path"
					onFileViewModeChange={() => {}}
					mainViewMode="graph"
					modified={[]}
					untracked={[]}
					staged={[]}
					selectedFile={null}
					onSelectFile={() => {}}
					onStageFile={() => {}}
					onUnstageFile={() => {}}
					onStageAll={() => {}}
					onUnstageAll={() => {}}
					hasProject
					selectedCommitHash={hash}
					commitDetailsLoading={false}
					commitDetails={{
						hash,
						parents: ["25debe6000000000000000000000000000000000"],
						diffParent: "25debe6000000000000000000000000000000000",
						message: "Fix dashboard loading performance",
						body: "Keep the graph readable while history refreshes.",
						author: "Ray Example",
						authorEmail: "ray@users.noreply.github.com",
						authoredAt: "2026-08-31T12:00:00-05:00",
						committer: "Release Bot",
						committerEmail: "release-bot@users.noreply.github.com",
						committedAt: "2026-08-31T12:05:00-05:00",
						refs: [
							{
								fullName: "refs/heads/main",
								displayName: "main",
								kind: "head",
								target: hash,
								isHead: true,
							},
						],
						files: [
							{
								path: "src/components/git/CommitGraph.tsx",
								status: "M",
								additions: 18,
								deletions: 4,
								binary: false,
							},
						],
					}}
					onSelectCommitFile={onSelectCommitFile}
					branch="main"
					commitMessage=""
					onCommitMessageChange={() => {}}
					onCommit={() => {}}
					isCommitting={false}
					amendMode={false}
					onAmendModeChange={() => {}}
					showCommitSection={false}
					onOpenGraph={onOpenGraph}
				/>,
			);
			await new Promise((resolve) => setTimeout(resolve, 30));
			expect(rootElement.textContent).toContain(`commit ${hash}`);
			expect(rootElement.textContent).toContain(
				"Fix dashboard loading performance",
			);
			expect(rootElement.textContent).toContain("Author");
			expect(rootElement.textContent).toContain("Committer");
			expect(rootElement.textContent).toContain("1: 25debe6");
			expect(rootElement.textContent).toContain(
				"src/components/git/CommitGraph.tsx",
			);
			rootElement
				.querySelector('button[aria-label="Repository graph"]')
				?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
			expect(onOpenGraph).toHaveBeenCalledOnce();
			rootElement
				.querySelector("[data-git-file-select]")
				?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
			expect(onSelectCommitFile).toHaveBeenCalledOnce();
		} finally {
			root.unmount();
		}
	});

	test("keeps incomplete historical author metadata inside the details panel", async () => {
		const { ChangeFileSidebar } = await import(
			"../src/components/git/ChangeFileSidebar.tsx"
		);
		const { root, rootElement } = setupDom();
		const hash = "47e2380000000000000000000000000000000000";
		try {
			root.render(
				<ChangeFileSidebar
					cwd="/fixture/repository"
					fileViewMode="path"
					onFileViewModeChange={() => {}}
					mainViewMode="graph"
					modified={[]}
					untracked={[]}
					staged={[]}
					selectedFile={null}
					onSelectFile={() => {}}
					onStageFile={() => {}}
					onUnstageFile={() => {}}
					onStageAll={() => {}}
					onUnstageAll={() => {}}
					hasProject
					selectedCommitHash={hash}
					commitDetailsLoading={false}
					commitDetails={
						{
							hash,
							parents: [],
							message: "Commit with legacy metadata",
							body: "",
							author: undefined,
							authorEmail: undefined,
							authoredAt: undefined,
							committer: undefined,
							committerEmail: undefined,
							committedAt: undefined,
							refs: [],
							files: [],
						} as unknown as import("../src/features/git/useGitGraph.tsx").CommitDetails
					}
					branch="main"
					commitMessage=""
					onCommitMessageChange={() => {}}
					onCommit={() => {}}
					isCommitting={false}
					amendMode={false}
					onAmendModeChange={() => {}}
					showCommitSection={false}
				/>,
			);
			await new Promise((resolve) => setTimeout(resolve, 30));
			expect(rootElement.textContent).toContain("Unknown author");
			expect(rootElement.textContent).toContain("Unknown date");
		} finally {
			root.unmount();
		}
	});

	test("fetches first-selection commit details and normalizes the native wire format", async () => {
		const { useCommitDetails } = await import(
			"../src/features/git/useGitGraph.tsx"
		);
		const { queryClient } = await import("../src/lib/query-client.ts");
		const { root, rootElement } = setupDom();
		const hash = "6be80ae0000000000000000000000000000000000";
		const previousFetch = globalThis.fetch;
		const fetchDetails = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				details: {
					hash,
					parents: [],
					diff_parent: null,
					message: "Keep the titlebar above search content",
					body: "",
					author: "Graph Author",
					author_email: "graph-author@users.noreply.github.com",
					authored_at: "2026-08-25T09:57:00-05:00",
					committer: "Graph Author",
					committer_email: "graph-author@users.noreply.github.com",
					committed_at: "2026-08-25T09:57:00-05:00",
					refs: [],
					files: [
						{
							path: "src/app.tsx",
							original_path: "src/old-app.tsx",
							status: "R",
							additions: 4,
							deletions: 2,
							binary: false,
						},
					],
				},
			}),
		})) as unknown as typeof fetch;
		globalThis.fetch = fetchDetails;
		function Harness() {
			const state = useCommitDetails(
				"/fixture/repository",
				hash,
				undefined,
				"revision-1",
			);
			return (
				<div data-loading={state.loading ? "true" : "false"}>
					{state.details
						? `${state.details.message}|${state.details.authorEmail}|${state.details.files[0]?.originalPath}`
						: "No details"}
				</div>
			);
		}
		try {
			root.render(<Harness />);
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(fetchDetails).toHaveBeenCalledOnce();
			expect(rootElement.textContent).toContain(
				"Keep the titlebar above search content",
			);
			expect(rootElement.textContent).toContain(
				"graph-author@users.noreply.github.com",
			);
			expect(rootElement.textContent).toContain("src/old-app.tsx");
		} finally {
			root.unmount();
			queryClient.removeQueries({
				queryKey: [
					"git",
					"commit",
					"/fixture/repository",
					"revision-1",
					hash,
					"",
				],
			});
			globalThis.fetch = previousFetch;
		}
	});

	test("renders the live WIP sidebar hierarchy and actions without duplicate labels", async () => {
		const { ChangeFileSidebar } = await import(
			"../src/components/git/ChangeFileSidebar.tsx"
		);
		const { dom, root, rootElement } = setupDom();
		const onStageAll = vi.fn();
		const onUnstageAll = vi.fn();
		const onSelectFile = vi.fn();
		const onCommit = vi.fn();
		try {
			root.render(
				<ChangeFileSidebar
					cwd="/fixture/repository"
					fileViewMode="path"
					onFileViewModeChange={() => {}}
					mainViewMode="graph"
					modified={[
						{
							status: "M",
							staged: false,
							path: "src/components/git/CommitGraph.tsx",
							additions: 12,
							deletions: 3,
						},
					]}
					untracked={[
						{
							status: "?",
							staged: false,
							path: "docs/reference/gitkraken/wip-changes.png",
							additions: 1,
						},
					]}
					staged={[
						{
							status: "A",
							staged: true,
							path: "GITKRAKEN.md",
							additions: 20,
						},
					]}
					selectedFile={null}
					onSelectFile={onSelectFile}
					onStageFile={() => {}}
					onUnstageFile={() => {}}
					onStageAll={onStageAll}
					onUnstageAll={onUnstageAll}
					hasProject
					selectedCommitHash="wip"
					selectedIsWip
					commitDetailsLoading={false}
					commitDetails={null}
					branch="main"
					commitMessage="Match GitKraken graph density"
					onCommitMessageChange={() => {}}
					onCommit={onCommit}
					isCommitting={false}
					amendMode={false}
					onAmendModeChange={() => {}}
					showFileActions
				/>,
			);
			await new Promise((resolve) => setTimeout(resolve, 30));
			expect(rootElement.textContent).toMatch(/Unstaged Files\s*2/);
			expect(rootElement.textContent).toMatch(/Staged Files\s*1/);
			expect(rootElement.textContent).not.toContain("Files Files");
			expect(rootElement.textContent).toContain("+33-3");
			expect(rootElement.textContent).toContain("main");
			expect(rootElement.textContent).toContain("Path");
			expect(rootElement.textContent).toContain("Tree");
			expect(rootElement.textContent).toContain("Commit 1 file");

			rootElement
				.querySelector('button[aria-label="Stage all files"]')
				?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
			rootElement
				.querySelector('button[aria-label="Unstage all files"]')
				?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
			rootElement
				.querySelector("[data-git-file-select]")
				?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
			const commitButton = Array.from(
				rootElement.querySelectorAll("button"),
			).find((button) => button.textContent?.includes("Commit 1 file"));
			commitButton?.dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true }),
			);
			expect(onStageAll).toHaveBeenCalledOnce();
			expect(onUnstageAll).toHaveBeenCalledOnce();
			expect(onSelectFile).toHaveBeenCalledOnce();
			expect(onCommit).toHaveBeenCalledOnce();
		} finally {
			root.unmount();
		}
	});

	test("renders busy, WIP, stash, merge, selected, ghost, and truncated states", async () => {
		const { CommitGraph } = await import(
			"../src/components/git/CommitGraph.tsx"
		);
		const base = graphCommit(0);
		const commits: GraphNode[] = [
			{
				...base,
				id: "wip",
				itemKind: "worktreeWip",
				hash: "head",
				message: "Uncommitted changes",
				parents: ["head"],
				refs: [],
				worktreePath: "/repo",
				column: 0,
			},
			{
				...base,
				id: "stash:stash@{0}",
				itemKind: "stash",
				hash: "stash-hash",
				message: "WIP on main",
				parents: ["head"],
				refs: [],
				stashName: "stash@{0}",
				column: 1,
				color: "#a855f7",
			},
			{
				...base,
				id: "head",
				hash: "head",
				message: "Merge feature",
				parents: ["main-parent", "feature-parent"],
				refs: [
					{
						fullName: "refs/heads/main",
						displayName: "main",
						kind: "head",
						target: "head",
						isHead: true,
					},
					{
						fullName: "refs/tags/v1.0",
						displayName: "v1.0",
						kind: "tag",
						target: "head",
						isHead: false,
					},
				],
				column: 0,
			},
			{
				...base,
				id: "feature-parent",
				hash: "feature-parent",
				message: "Feature work",
				parents: ["root"],
				refs: [
					{
						fullName: "refs/heads/feature",
						displayName: "feature",
						kind: "localBranch",
						target: "feature-parent",
						isHead: false,
					},
					{
						fullName: "refs/remotes/team/feature",
						displayName: "team/feature",
						kind: "remoteBranch",
						target: "feature-parent",
						remoteName: "team",
						isHead: false,
					},
				],
				column: 1,
				color: "#ec4899",
			},
			{
				...base,
				id: "main-parent",
				hash: "main-parent",
				message: "Main work",
				parents: ["root"],
				refs: [],
				column: 0,
			},
			{
				...base,
				id: "root",
				hash: "root",
				message: "Root",
				parents: ["missing-parent"],
				refs: [],
				column: 0,
			},
		];
		const rows: GraphRow[] = [
			{
				row: 0,
				rails: [{ column: 0, color: "#22b8cf" }],
				transitions: [],
				convergences: [],
				truncatedEdges: [],
			},
			{
				row: 1,
				rails: [
					{ column: 0, color: "#22b8cf" },
					{ column: 1, color: "#a855f7" },
				],
				transitions: [{ fromColumn: 1, toColumn: 0, color: "#a855f7" }],
				convergences: [],
				truncatedEdges: [],
			},
			{
				row: 2,
				rails: [{ column: 0, color: "#22b8cf" }],
				transitions: [{ fromColumn: 0, toColumn: 1, color: "#ec4899" }],
				convergences: [],
				truncatedEdges: [],
			},
			{
				row: 3,
				rails: [
					{ column: 0, color: "#22b8cf" },
					{ column: 1, color: "#ec4899" },
				],
				transitions: [],
				convergences: [],
				truncatedEdges: [],
			},
			{
				row: 4,
				rails: [
					{ column: 0, color: "#22b8cf" },
					{ column: 1, color: "#ec4899" },
				],
				transitions: [{ fromColumn: 1, toColumn: 0, color: "#ec4899" }],
				convergences: [],
				truncatedEdges: [],
			},
			{
				row: 5,
				rails: [{ column: 0, color: "#22b8cf" }],
				transitions: [],
				convergences: [],
				truncatedEdges: [{ column: 0, color: "#22b8cf" }],
			},
		];
		const worktrees = [
			{
				path: "/repo",
				head: "head",
				branch: "main",
				isCurrent: true,
				bare: false,
				locked: false,
				status: {
					cwd: "/repo",
					name: "repo",
					branch: "main",
					upstream: null,
					ahead: 0,
					behind: 0,
					stagedCount: 1,
					unstagedCount: 1,
					untrackedCount: 0,
					files: [
						{ status: "M", staged: false, path: "src/app.tsx" },
						{ status: "M", staged: true, path: "src/graph.ts" },
					],
				},
			},
		];
		const { dom, root, rootElement } = setupDom();
		const onRefDrop = vi.fn();
		function Harness() {
			const [selected, setSelected] = useState("stash:stash@{0}");
			return (
				<CommitGraph
					commits={commits}
					rows={rows}
					worktrees={worktrees}
					selectedHash={selected}
					onSelect={setSelected}
					onRefDrop={onRefDrop}
					repositoryKey="/busy-fixture"
					embedded
				/>
			);
		}
		try {
			root.render(<Harness />);
			await new Promise((resolve) => setTimeout(resolve, 30));
			expect(
				rootElement.querySelector('[data-graph-kind="worktreeWip"]'),
			).toBeTruthy();
			expect(
				rootElement.querySelector('[data-graph-kind="stash"]'),
			).toBeTruthy();
			const mainBadge = rootElement.querySelector(
				'[data-graph-item="head"] [data-ref-kind="head"]',
			);
			expect(mainBadge).toBeTruthy();
			(mainBadge as HTMLElement | null)?.focus();
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(rootElement.querySelector('[data-ref-kind="tag"]')).toBeTruthy();
			const featureBadge = rootElement.querySelector(
				'[data-graph-item="feature-parent"] [data-ref-kind="localBranch"]',
			);
			(featureBadge as HTMLElement | null)?.focus();
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(
				rootElement.querySelector('[data-ref-kind="remoteBranch"]'),
			).toBeTruthy();
			const dragValues = new Map<string, string>();
			const dataTransfer = {
				effectAllowed: "none",
				dropEffect: "none",
				setData(type: string, value: string) {
					dragValues.set(type, value);
				},
				getData(type: string) {
					return dragValues.get(type) ?? "";
				},
			};
			const dragStart = new dom.window.Event("dragstart", {
				bubbles: true,
				cancelable: true,
			});
			Object.defineProperty(dragStart, "dataTransfer", { value: dataTransfer });
			featureBadge?.dispatchEvent(dragStart);
			const drop = new dom.window.Event("drop", {
				bubbles: true,
				cancelable: true,
			});
			Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
			mainBadge?.dispatchEvent(drop);
			expect(onRefDrop).toHaveBeenCalledWith("feature", "main");
			featureBadge?.dispatchEvent(
				new dom.window.MouseEvent("mouseenter", { bubbles: true }),
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(featureBadge?.getAttribute("data-ref-hovered")).toBe("true");
			expect(
				rootElement
					.querySelector('[data-graph-item="feature-parent"]')
					?.getAttribute("data-history-match"),
			).toBe("true");
			expect(
				rootElement
					.querySelector('[data-graph-item="head"]')
					?.getAttribute("data-history-match"),
			).toBe("true");
			const featureRow = rootElement.querySelector(
				'[data-graph-item="feature-parent"]',
			);
			featureRow?.dispatchEvent(
				new dom.window.MouseEvent("mouseenter", { bubbles: true }),
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
			const hoverWash = featureRow?.querySelector(
				'[data-graph-row-wash="true"]',
			) as HTMLElement | null;
			expect(hoverWash?.getAttribute("data-graph-row-hovered")).toBe("true");
			expect(hoverWash?.style.left).toBe("369px");
			expect(hoverWash?.style.top).toBe("2.5px");
			expect(hoverWash?.style.height).toBe("18px");
			expect(hoverWash?.style.backgroundColor).toBe("rgba(236, 72, 153, 0.42)");
			featureBadge?.dispatchEvent(
				new dom.window.MouseEvent("mouseleave", { bubbles: true }),
			);
			expect(
				rootElement.querySelectorAll('[data-graph-transition="true"]'),
			).toHaveLength(3);
			expect(
				rootElement.querySelector('[data-graph-truncated="true"]'),
			).toBeTruthy();
			expect(
				rootElement
					.querySelector('[data-graph-kind="stash"]')
					?.getAttribute("aria-selected"),
			).toBe("true");

			rootElement
				.querySelector('[data-graph-item="root"]')
				?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(rootElement.querySelector('[data-ref-ghost="true"]')).toBeTruthy();
		} finally {
			root.unmount();
		}
	});
});
