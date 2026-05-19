import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
	isSafeRelativePath,
	isWithinDirectory,
	resolveAllowedChildPath,
} from "../src/server/security.ts";
import {
	getDiffParams,
	safeHash,
	safeLimit,
} from "../src/server/routes/git-route-input.ts";

describe("local path and git route input normalization", () => {
	/*
	 * This protects the local file boundary used by routes that read files, run
	 * git commands, or expose diffs. Directory traversal and absolute child paths
	 * are cheap to test here and expensive to discover after a route starts
	 * touching files outside the intended workspace.
	 */
	test("rejects unsafe relative child paths while allowing normal nested paths", () => {
		expect(isSafeRelativePath("src/server/routes/git.ts")).toBe(true);
		expect(isSafeRelativePath("src\\server\\routes\\git.ts")).toBe(true);
		expect(isSafeRelativePath("../secrets.yaml")).toBe(false);
		expect(isSafeRelativePath("src/../../secrets.yaml")).toBe(false);
		expect(isSafeRelativePath("/tmp/secrets.yaml")).toBe(false);
		expect(isSafeRelativePath("src/\0/secrets.yaml")).toBe(false);
	});

	/*
	 * This protects path resolution at the service boundary: callers may pass
	 * normalized or not-yet-normalized paths, but the resolved result must still
	 * stay inside the allowed parent directory. A sibling with the same prefix
	 * must not be treated as a child.
	 */
	test("keeps resolved child paths inside their parent directory", () => {
		const root = resolve(process.cwd(), "tests");
		expect(isWithinDirectory(resolve(root, "nested/file.ts"), root)).toBe(true);
		expect(isWithinDirectory(root, root)).toBe(true);
		expect(
			isWithinDirectory(resolve(process.cwd(), "tests-other/file.ts"), root)
		).toBe(false);

		expect(resolveAllowedChildPath(root, "nested/file.ts")).toBe(
			resolve(root, "nested/file.ts")
		);
		expect(resolveAllowedChildPath(root, "../package.json")).toBeNull();
	});

	/*
	 * This protects the git diff route's request contract. The route eventually
	 * shells out to git, so normalizing limits, hashes, staged flags, cwd, and
	 * file names before that boundary prevents malformed input from becoming
	 * command or filesystem behavior.
	 */
	test("normalizes git diff query parameters before route handlers use them", () => {
		const cwd = process.cwd();
		const request = new Request(
			`http://localhost/api/git/diff?cwd=${encodeURIComponent(cwd)}&file=${encodeURIComponent("src/server/routes/git.ts")}&staged=true`
		);

		expect(getDiffParams(request)).toEqual({
			cwd,
			file: "src/server/routes/git.ts",
			staged: true,
		});

		expect(
			getDiffParams(
				new Request(
					`http://localhost/api/git/diff?cwd=${encodeURIComponent(cwd)}&file=../package.json`
				)
			)
		).toBeNull();

		expect(safeHash("abc1234")).toBe(true);
		expect(safeHash("ABCDEF1234567890")).toBe(true);
		expect(safeHash("not-a-hash")).toBe(false);
		expect(safeLimit("99.8", 25, 50)).toBe(50);
		expect(safeLimit("-4", 25, 50)).toBe(1);
		expect(safeLimit("not-a-number", 25, 50)).toBe(25);
	});
});
