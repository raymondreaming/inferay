import { expect, test } from "bun:test";
import { memoryTitle } from "../../src/shared/services/memoryApi.ts";

test("titles drop inline markdown", () => {
	expect(
		memoryTitle(
			"The signals scanner **chains smaller pattern arrays** until `10`.",
		),
	).toBe("The signals scanner chains smaller pattern arrays until 10.");
	expect(memoryTitle("## See [patterns.rs](/x/patterns.rs:14) now")).toBe(
		"See patterns.rs now",
	);
	expect(memoryTitle("\n\n")).toBe("Saved from chat");
});
