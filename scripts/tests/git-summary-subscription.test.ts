import { expect, test } from "bun:test";

test("repository summaries follow graph ownership in the browser runtime", () => {
	const result = Bun.spawnSync(
		[
			process.execPath,
			"--conditions=browser",
			"test",
			"./scripts/tests/fixtures/git-summary-subscription.case.ts",
		],
		{ cwd: new URL("../..", import.meta.url).pathname },
	);
	expect(new TextDecoder().decode(result.stderr)).toContain("0 fail");
	expect(result.exitCode).toBe(0);
});
