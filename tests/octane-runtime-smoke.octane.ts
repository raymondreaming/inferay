import { createRoot } from "octane";
import { expect, test } from "vitest";

test("loads the Octane browser runtime", () => {
	expect(typeof createRoot).toBe("function");
});
