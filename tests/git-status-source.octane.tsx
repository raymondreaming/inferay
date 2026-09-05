import { JSDOM } from "jsdom";
import { createRoot } from "octane";
import { expect, test, vi } from "vitest";
import { useGitGraph } from "../src/modules/repository/hooks/useGitGraph.tsx";
import { useGitStatus } from "../src/modules/repository/hooks/useGitStatus.tsx";
import { queryClient } from "../src/shared/lib/query-client.ts";

test("graph status owns covered repositories, preserves optimistic updates, and falls back on failure", async () => {
	const dom = new JSDOM('<div id="root"></div>', {
		url: "http://localhost",
		pretendToBeVisual: true,
	});
	for (const name of [
		"window",
		"document",
		"HTMLElement",
		"Element",
		"Node",
	] as const)
		Object.defineProperty(globalThis, name, {
			configurable: true,
			value: name === "window" ? dom.window : dom.window[name],
		});
	queryClient.clear();
	const previousFetch = globalThis.fetch;
	const status = (cwd: string, stagedCount = 0) => ({
		cwd,
		name: cwd,
		branch: "main",
		upstream: null,
		ahead: 0,
		behind: 0,
		stagedCount,
		unstagedCount: 0,
		untrackedCount: 0,
		files: [],
	});
	let graphCount = 0;
	let graphFailed = false;
	let stagedCount = 0;
	const requests: string[][] = [];
	globalThis.fetch = vi.fn(async (url, options) => {
		if (String(url).startsWith("/api/git/graph")) {
			graphCount++;
			return Response.json({
				revision: String(graphCount),
				state: graphFailed ? "commandFailed" : "ready",
				worktrees: [{ path: "/repo", status: status("/repo", stagedCount) }],
			});
		}
		const cwds = JSON.parse(options?.body as string).cwds as string[];
		requests.push(cwds);
		return Response.json(cwds.map((cwd) => status(cwd, stagedCount)));
	}) as typeof fetch;
	let current: ReturnType<typeof useGitStatus>;
	const cwds = ["/repo", "/other"];
	function Consumer() {
		const graph = useGitGraph("/repo", 100);
		current = useGitStatus(cwds, { enabled: true, graph });
		return <span>{current.projectMap.get("/repo")?.stagedCount}</span>;
	}
	const element = dom.window.document.getElementById("root")!;
	const root = createRoot(element);
	try {
		root.render(<Consumer />);
		await vi.waitFor(() => expect(requests.at(-1)).toEqual(["/other"]));
		await vi.waitFor(() => expect(current!.loaded).toBe(true));
		current!.applyOptimistic("/repo", (project) => ({
			...project,
			stagedCount: 1,
		}));
		await vi.waitFor(() => expect(element.textContent).toBe("1"));
		stagedCount = 1;
		const before = graphCount;
		await current!.refetch();
		expect(graphCount).toBe(before + 1);
		expect(requests.at(-1)).toEqual(["/other"]);
		expect(element.textContent).toBe("1");
		graphFailed = true;
		await current!.refetch();
		await vi.waitFor(() =>
			expect(requests.at(-1)).toEqual(["/repo", "/other"]),
		);
		expect(current!.projectMap.has("/other")).toBe(true);
	} finally {
		root.unmount();
		queryClient.clear();
		globalThis.fetch = previousFetch;
		dom.window.close();
	}
});
