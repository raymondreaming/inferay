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
		source.slice(source.indexOf("type AuthorCommit")).replaceAll("export ", ""),
	);
	let requests = 0;
	const dependencies = {
		...signals,
		readStoredJson: (_key: string, fallback: unknown) => fallback,
		writeStoredValue: () => {},
		resolveGitCommitAvatars: async () => {
			requests++;
			return { old: "https://example.com/avatar.png" };
		},
	};
	const [useAvatars, rememberLoaded] = new Function(
		...Object.keys(dependencies),
		`${code}; return [useGitAuthorAvatars, rememberLoadedAuthorAvatar];`,
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
		await Promise.resolve();
		signals.flush();
		expect(avatar(old)).toBe("https://example.com/avatar.png");
		// Only a successfully loaded image becomes reusable across hashes.
		rememberLoaded(old.authorEmail, avatar(old));
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
		expect(requests).toBe(1);
	} finally {
		dispose();
	}
});
