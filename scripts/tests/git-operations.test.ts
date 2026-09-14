import { expect, test } from "bun:test";
import type { GitActionResponse } from "@contracts";
import { createGitOperations } from "@repository/services/gitOperations.ts";

test("Git operations use their injected port, refresh before selecting, and preserve native failures", async () => {
	const events: unknown[] = [];
	const result: GitActionResponse = {
		ok: true,
		operation: "merge",
		outcome: "completed",
		conflicts: [],
		errorLabel: "Git command failed",
		selection: { commit: "head" },
	};
	const operations = createGitOperations(
		"/repo",
		async () => {
			events.push("refresh");
		},
		(id) => {
			events.push(id);
		},
		async (cwd, endpoint, input) => {
			events.push({ cwd, endpoint, input });
			return result;
		},
	);
	const input = {
		operation: "merge",
		action: "start",
		source: "feature",
		target: "main",
	} as const;
	expect(await operations.runGraphRefOperation(input)).toBe(result);
	expect(events).toEqual([
		{ cwd: "/repo", endpoint: "ref-operation", input },
		"refresh",
		"head",
	]);
	result.ok = false;
	delete result.selection;
	events.length = 0;
	expect(await operations.runGraphRefOperation(input)).toBe(result);
	expect(events).toHaveLength(2);
});

test("missing repositories and transport errors use native action failure contracts", async () => {
	let called = false;
	const missing = createGitOperations(
		undefined,
		async () => {},
		() => {},
		async () => {
			called = true;
			throw new Error("must not send");
		},
	);
	expect(
		await missing.runGraphActionRequest({ action: "fetch" }),
	).toMatchObject({
		ok: false,
		operation: "fetch",
		outcome: "failed",
		conflicts: [],
		error: "No Git repository selected",
		errorKind: "invalidInput",
		errorLabel: "Invalid Git action",
	});
	expect(called).toBe(false);
	const offline = createGitOperations(
		"/repo",
		async () => {
			throw new Error("must not refresh");
		},
		() => {},
		async () => {
			throw new Error("offline");
		},
	);
	expect(
		await offline.runGraphActionRequest({ action: "fetch" }),
	).toMatchObject({
		error: "offline",
		errorKind: "commandFailed",
		errorLabel: "Git command failed",
	});
	const rejected = createGitOperations(
		"/repo",
		async () => {},
		() => {},
		async () => {
			throw "offline";
		},
	);
	expect(
		await rejected.runGraphActionRequest({ action: "fetch" }),
	).toMatchObject({ error: "Git action failed" });
});
