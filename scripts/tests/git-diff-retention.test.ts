import { expect, test } from "bun:test";

test("diff cache preserves viewers and discards superseded revisions", () => {
	const result = Bun.spawnSync(
		[
			process.execPath,
			"--conditions=browser",
			"test",
			"./scripts/tests/fixtures/git-diff-retention.case.ts",
		],
		{ cwd: new URL("../..", import.meta.url).pathname },
	);
	expect(new TextDecoder().decode(result.stderr)).toContain("0 fail");
	expect(result.exitCode).toBe(0);
});
