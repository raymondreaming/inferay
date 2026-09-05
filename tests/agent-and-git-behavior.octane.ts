import { describe, expect, test } from "vitest";
import { isAgentMainView } from "../src/app/model/navigation.tsx";
import {
	getFileSelectionAfterToggle,
	visibleGitFiles,
} from "../src/modules/workbench/changes/components/ChangesPanel/index.tsx";

describe("agent state and git change behavior", () => {
	test("accepts only current agent main views", () => {
		expect(isAgentMainView("editor")).toBe(false);
		expect(isAgentMainView("chat")).toBe(true);
		expect(isAgentMainView("missing")).toBe(false);
	});

	test("uses native ordering while preserving optimistic staged file objects", () => {
		const staged = { path: "src/a.rs", staged: true, status: "M" };
		const unstaged = { ...staged, staged: false };
		const layout = {
			pathOrder: ["src-a.rs", "src/a.rs"],
			treeOrder: ["src/a.rs", "src-a.rs"],
			tree: [],
		};
		expect(visibleGitFiles([staged], layout, "tree")).toEqual([staged]);
		expect(visibleGitFiles([unstaged], layout, "path")[0]).toBe(unstaged);
	});

	test("selects the next file in the same section after staging or unstaging", () => {
		const files = [
			{ path: "a.ts", staged: false, status: "M" },
			{ path: "b.ts", staged: false, status: "M" },
			{ path: "c.ts", staged: false, status: "M" },
			{ path: "d.ts", staged: true, status: "M" },
			{ path: "e.ts", staged: true, status: "M" },
		];

		expect(
			getFileSelectionAfterToggle(files, {
				path: "b.ts",
				staged: false,
			}),
		).toBe(files[2]);
		expect(
			getFileSelectionAfterToggle(files, {
				path: "c.ts",
				staged: false,
			}),
		).toBe(files[1]);
		expect(
			getFileSelectionAfterToggle(files, {
				path: "d.ts",
				staged: true,
			}),
		).toBe(files[4]);

		expect(
			getFileSelectionAfterToggle([files[0]!, files[3]!], {
				path: "a.ts",
				staged: false,
			}),
		).toEqual({ path: "a.ts", staged: true, status: "M" });
	});
});
