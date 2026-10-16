import { expect, spyOn, test } from "bun:test";
import type { DiffRequest } from "@contracts";
import { createRoot, createSignal, flush } from "solid-js";
import {
	useDiffPrefetch,
	useGitDiff,
} from "../../../src/modules/repository/hooks/useGitDiff.tsx";
import { queryClient } from "../../../src/shared/lib/dom.tsx";

test("only successful replacements release unobserved, settled older revisions", async () => {
	const pending = new Map<string, (response: Response) => void>();
	const fetch = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			(input: RequestInfo | URL) =>
				new Promise<Response>((resolve) => {
					pending.set(
						new URL(String(input), "http://fixture").searchParams.get(
							"revision",
						)!,
						resolve,
					);
				}),
			{ preconnect: globalThis.fetch.preconnect },
		),
	);
	const disposers: (() => void)[] = [];
	const request = (revision: string, file = "source.txt"): DiffRequest => ({
		cwd: "/fixture",
		file,
		staged: false,
		revision,
	});
	const settle = async () => {
		flush();
		await Bun.sleep(10);
		flush();
	};
	const finish = async (revision: string, failed = false) => {
		expect(pending.has(revision)).toBe(true);
		pending.get(revision)!(
			Response.json(
				failed ? { error: "fixture failure" } : { isBinary: true, revision },
				{ status: failed ? 500 : 200 },
			),
		);
		pending.delete(revision);
		await settle();
	};
	const revisions = () =>
		queryClient
			.getQueryCache()
			.findAll({ queryKey: ["git-diff"] })
			.map((q) => q.queryKey[3]);
	const viewer = (revision: string, file = "source.txt") =>
		createRoot((dispose) => {
			disposers.push(dispose);
			const [value, set] = createSignal<DiffRequest | null>(
				request(revision, file),
			);
			const result = useGitDiff(value);
			return { set, result, dispose };
		});
	const prefetch = createRoot((dispose) => {
		disposers.push(dispose);
		return useDiffPrefetch();
	});
	try {
		const first = viewer("first");
		const other = viewer("other", "other.txt");
		await settle();
		await finish("first");
		await finish("other");
		other.dispose();
		const second = viewer("second");
		await settle();
		await finish("second");
		expect(revisions()).toContain("first"); // A different pane still owns it.
		first.dispose();
		second.set(request("third"));
		await settle();
		expect(second.result.diff).not.toBeNull(); // Previous content remains while loading.
		await finish("third");
		expect(revisions()).not.toContain("first");
		expect(revisions()).not.toContain("second");
		expect(revisions()).toContain("other");
		second.set(request("failed"));
		await settle();
		await finish("failed", true);
		expect(second.result.error).toContain("fixture failure");
		expect(revisions()).toContain("third"); // Failure never evicts the last good result.

		prefetch([request("slow")]);
		await Bun.sleep(100);
		await settle();
		second.set(request("newer"));
		await settle();
		await finish("newer");
		expect(revisions()).toContain("slow"); // The older request is still in flight.
		second.set(null);
		await settle();
		await finish("slow");
		expect(revisions()).toContain("newer"); // Late completion cannot evict a newer result.

		const cancelled = viewer("cancelled");
		await settle();
		cancelled.dispose();
		await finish("cancelled");
		expect(revisions()).toContain("newer");
	} finally {
		for (const dispose of disposers) dispose();
		queryClient.clear();
		fetch.mockRestore();
	}
});

test("conditional diffs preserve identity only for the same request scope", async () => {
	const requests: { revision: string; etag: string | null }[] = [];
	const fetch = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const revision = new URL(
					String(input),
					"http://fixture",
				).searchParams.get("revision")!;
				requests.push({
					revision,
					etag: new Headers(init?.headers).get("if-none-match"),
				});
				if (["two", "recovered", "unsolicited"].includes(revision))
					return new Response(null, { status: 304 });
				if (revision === "failed")
					return Response.json({ error: "fixture failure" }, { status: 503 });
				return Response.json(
					{ isBinary: true, revision },
					{ headers: { etag: `"${revision}"` } },
				);
			},
			{ preconnect: globalThis.fetch.preconnect },
		),
	);
	const base = {
		cwd: "/fixture",
		file: "source.txt",
		staged: false,
		view: "full" as const,
	};
	const [request, setRequest] = createSignal<DiffRequest | null>(null);
	let dispose = () => {};
	const result = createRoot((cleanup) => {
		dispose = cleanup;
		return useGitDiff(request);
	});
	const read = async (revision: string, change: Partial<DiffRequest> = {}) => {
		setRequest({ ...base, revision, ...change });
		flush();
		await Bun.sleep(10);
		flush();
		return result.diff;
	};
	try {
		const first = await read("one");
		expect(first).not.toBeNull();
		expect(await read("two")).toBe(first);
		expect(requests.at(-1)?.etag).toBe('"one"');
		for (const [revision, change] of [
			["other", { file: "other.txt" }],
			["staged", { staged: true }],
			["review", { view: "review" }],
			["commit", { commitHash: "abc123" }],
		] as const) {
			await read(revision, change);
			expect(requests.at(-1)?.etag).toBeNull();
		}
		const changed = await read("changed");
		expect(requests.at(-1)?.etag).toBe('"one"');
		expect(changed).not.toBe(first);
		expect(await read("failed")).toBeNull();
		expect(result.error).toBe("fixture failure");
		expect(await read("recovered")).toBe(changed);
		expect(requests.at(-1)?.etag).toBe('"changed"');
		expect(result.error).toBeUndefined();
		expect(await read("unsolicited", { cwd: "/uncached" })).toBeNull();
		expect(requests.at(-1)?.etag).toBeNull();
		expect(result.error).toContain("304");
	} finally {
		dispose();
		queryClient.clear();
		fetch.mockRestore();
	}
});
