import { expect, test } from "bun:test";

// Solid's server export does not propagate signal writes. Keep each browser
// fixture isolated from server tests and from other fixtures' module state.
for (const fixture of [
	"git-summary-subscription",
	"git-diff-retention",
	"project-navigation",
]) {
	test(`${fixture} uses the browser reactive runtime`, () => {
		const result = Bun.spawnSync(
			[
				process.execPath,
				"--conditions=browser",
				"test",
				`./scripts/tests/fixtures/${fixture}.case.ts`,
			],
			{ cwd: new URL("../..", import.meta.url).pathname },
		);
		expect(new TextDecoder().decode(result.stderr)).toContain("0 fail");
		expect(result.exitCode).toBe(0);
	});
}
