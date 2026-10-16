import { expect, test } from "bun:test";

// Solid's server export deliberately does not propagate signal writes. Exercise
// navigation against the browser reactive runtime, isolated from server tests.
test("project navigation uses the browser reactive runtime", () => {
	const result = Bun.spawnSync(
		[
			process.execPath,
			"--conditions=browser",
			"test",
			"./scripts/tests/fixtures/project-navigation.case.ts",
		],
		{ cwd: new URL("../..", import.meta.url).pathname },
	);
	expect(new TextDecoder().decode(result.stderr)).toContain("0 fail");
	expect(result.exitCode).toBe(0);
});
