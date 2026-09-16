import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as signals from "@solidjs/signals";

test("new hashes and repositories reuse a known author before any lookup", async () => {
	const source = readFileSync(
		new URL(
			"../../src/modules/repository/hooks/useGitAuthorAvatars.ts",
			import.meta.url,
		),
		"utf8",
	);
	const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
		source.slice(source.indexOf("const [avatars,")).replaceAll("export ", ""),
	);
	const timers = new Map<number, () => void>();
	let timerId = 0;
	let requests = 0;
	const dependencies = {
		...signals,
		window: {
			setTimeout: (callback: () => void) => {
				timers.set(++timerId, callback);
				return timerId;
			},
			clearTimeout: (id: number) => timers.delete(id),
		},
		resolveGitCommitAvatars: async () => {
			requests++;
			return { old: "https://example.com/avatar.png" };
		},
	};
	const useAvatars = new Function(
		...Object.keys(dependencies),
		`${code}; return useGitAuthorAvatars;`,
	)(...Object.values(dependencies));
	const old = { hash: "old", author: "Ray", authorEmail: "ray@example.com" };
	const rebased = { ...old, hash: "rebased", authorEmail: "Ray@Example.com" };
	let dispose = () => {};
	let update!: (commits: (typeof old)[]) => void;
	let avatar!: (commit: typeof old) => string | undefined;
	try {
		signals.createRoot((cleanup) => {
			dispose = cleanup;
			const [commits, setCommits] = signals.createSignal([old]);
			update = setCommits;
			avatar = useAvatars(() => "/first-repo", commits);
		});
		signals.flush();
		for (const callback of timers.values()) callback();
		timers.clear();
		await Promise.resolve();
		signals.flush();
		expect(avatar(old)).toBe("https://example.com/avatar.png");
		update([rebased]);
		// No effect flush, timer, or network round trip before rendering.
		expect(avatar(rebased)).toBe("https://example.com/avatar.png");
		signals.flush();
		dispose();
		signals.createRoot((cleanup) => {
			dispose = cleanup;
			avatar = useAvatars(
				() => "/second-repo",
				() => [rebased],
			);
		});
		expect(avatar(rebased)).toBe("https://example.com/avatar.png");
		expect(
			avatar({
				...rebased,
				hash: "unknown",
				authorEmail: "someone-else@example.com",
			}),
		).toBeUndefined();
		signals.flush();
		expect(timers.size).toBe(0);
		expect(requests).toBe(1);
	} finally {
		dispose();
	}
});
