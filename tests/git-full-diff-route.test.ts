import { describe, expect, test } from "bun:test";
import { mkdtemp, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getHunkDiff } from "../src/server/routes/git.ts";

async function git(cwd: string, args: string[]) {
	const proc = Bun.spawn(["git", ...args], { cwd });
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed`);
	}
}

async function makeRepo() {
	const cwd = await mkdtemp(
		join(homedir(), ".codex/memories/inferay-diff-test-")
	);
	await git(cwd, ["init"]);
	await git(cwd, ["config", "user.email", "test@example.com"]);
	await git(cwd, ["config", "user.name", "Test User"]);
	return cwd;
}

describe("git full diff route data", () => {
	test("returns a raw patch for unstaged tracked edits", async () => {
		const cwd = await makeRepo();
		await Bun.write(join(cwd, "tracked.ts"), "export const value = 1;\n");
		await git(cwd, ["add", "tracked.ts"]);
		await git(cwd, ["commit", "-m", "initial"]);
		await Bun.write(join(cwd, "tracked.ts"), "export const value = 2;\n");

		const diff = await getHunkDiff(cwd, "tracked.ts", false);
		expect(diff.rawPatch).toContain("diff --git a/tracked.ts b/tracked.ts");
		expect(diff.rawPatch).toContain("--- a/tracked.ts");
		expect(diff.rawPatch).toContain("+++ b/tracked.ts");
		expect(diff.newLines.some((line) => line.type === "add")).toBe(true);
	});

	test("returns separate raw patches for AM staged and unstaged states", async () => {
		const cwd = await makeRepo();
		await Bun.write(join(cwd, "added.ts"), "export const value = 1;\n");
		await git(cwd, ["add", "added.ts"]);
		await Bun.write(join(cwd, "added.ts"), "export const value = 2;\n");

		const staged = await getHunkDiff(cwd, "added.ts", true);
		const unstaged = await getHunkDiff(cwd, "added.ts", false);

		expect(staged.rawPatch).toContain("new file mode");
		expect(unstaged.rawPatch).toContain("--- a/added.ts");
		expect(unstaged.rawPatch).toContain("+++ b/added.ts");
		expect(staged.rawPatch).toContain("+export const value = 1;");
		expect(unstaged.rawPatch).toContain("-export const value = 1;");
		expect(unstaged.rawPatch).toContain("+export const value = 2;");
	});

	test("renders deleted files without reading the missing worktree file", async () => {
		const cwd = await makeRepo();
		await Bun.write(join(cwd, "deleted.ts"), "export const gone = true;\n");
		await git(cwd, ["add", "deleted.ts"]);
		await git(cwd, ["commit", "-m", "initial"]);
		await unlink(join(cwd, "deleted.ts"));

		const diff = await getHunkDiff(cwd, "deleted.ts", false);
		expect(diff.rawPatch).toContain("deleted file mode");
		expect(diff.oldLines.some((line) => line.type === "remove")).toBe(true);
		expect(diff.newLines.every((line) => line.type === "spacer")).toBe(true);
	});

	test("preserves raw patches for renamed files", async () => {
		const cwd = await makeRepo();
		await Bun.write(join(cwd, "old-name.ts"), "export const renamed = true;\n");
		await git(cwd, ["add", "old-name.ts"]);
		await git(cwd, ["commit", "-m", "initial"]);
		await git(cwd, ["mv", "old-name.ts", "new-name.ts"]);

		const diff = await getHunkDiff(cwd, "new-name.ts", true);
		expect(diff.rawPatch).toContain("rename from old-name.ts");
		expect(diff.rawPatch).toContain("rename to new-name.ts");
	});

	test("keeps image diffs binary while still exposing raw git patch text", async () => {
		const cwd = await makeRepo();
		await Bun.write(join(cwd, "image.png"), new Uint8Array([137, 80, 78, 71]));
		await git(cwd, ["add", "image.png"]);
		await git(cwd, ["commit", "-m", "initial"]);
		await Bun.write(
			join(cwd, "image.png"),
			new Uint8Array([137, 80, 78, 71, 1])
		);

		const diff = await getHunkDiff(cwd, "image.png", false);
		expect(diff.isBinary).toBe(true);
		expect(diff.isImage).toBe(true);
		expect(diff.rawPatch).toContain("diff --git a/image.png b/image.png");
	});

	test("falls back safely for very long lines but keeps the raw patch", async () => {
		const cwd = await makeRepo();
		await Bun.write(join(cwd, "long.ts"), `${"a".repeat(9001)}\n`);
		await git(cwd, ["add", "long.ts"]);
		await git(cwd, ["commit", "-m", "initial"]);
		await Bun.write(join(cwd, "long.ts"), `${"b".repeat(9001)}\n`);

		const diff = await getHunkDiff(cwd, "long.ts", false);
		expect(diff.newLines[0]?.content).toContain("very long line");
		expect(diff.rawPatch).toContain("diff --git a/long.ts b/long.ts");
	});

	test("marks files with merge conflict markers for the custom conflict viewer", async () => {
		const cwd = await makeRepo();
		const content = [
			"export const value = 1;",
			"<<<<<<< HEAD",
			"export const side = 'current';",
			"=======",
			"export const side = 'incoming';",
			">>>>>>> feature",
			"",
		].join("\n");
		await Bun.write(join(cwd, "conflict.ts"), content);

		const diff = await getHunkDiff(cwd, "conflict.ts", false);
		expect(diff.mergeConflictContent).toBe(content);
		expect(diff.rawPatch).toContain("diff --git a/conflict.ts b/conflict.ts");
	});
});
