import { resolve } from "node:path";
import type { GitProjectStatus } from "../../features/git/types.ts";
import { rangeContainsLine } from "../../lib/data.ts";
import { badRequest, tryRoute } from "../../lib/route-helpers.ts";
import { resolveRealAllowedLocalPath } from "../security.ts";
import { unwatchDirectory, watchDirectory } from "../services/file-watcher.ts";
import {
	checkoutBranch,
	commit,
	createWorktree,
	discardFileChanges,
	discardWorktree,
	getBlame,
	getBranches,
	getCommitDetails,
	getDiff,
	getFileHistory,
	getGraphLog,
	getLog,
	getStatus,
	mergeWorktree,
	stageAll,
	stageFile,
	unstageAll,
	unstageFile,
} from "../services/git.ts";
import {
	getNativeGitGraph,
	getNativeGitStatuses,
} from "../services/native-git.ts";
import {
	getDiffParams,
	isChangedGitFile,
	safeCwd,
	safeFilePath,
	safeHash,
	safeLimit,
} from "./git-route-input.ts";

interface DiffLine {
	number: number | null;
	content: string;
	type: "add" | "remove" | "context" | "spacer" | "hunk";
}

interface HunkDiff {
	oldLines: DiffLine[];
	newLines: DiffLine[];
	isBinary: boolean;
	isNew: boolean;
	isImage?: boolean;
	imagePath?: string;
	rawPatch?: string;
	mergeConflictContent?: string;
}

const MAX_UNTRACKED_FILE_BYTES = 500_000;
const MAX_RENDERED_DIFF_LINES = 12_000;
const MAX_RENDERED_LINE_CHARS = 8000;

const IMAGE_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".svg",
	".ico",
	".bmp",
]);

function isImageFile(filePath: string): boolean {
	const ext = filePath.toLowerCase().slice(filePath.lastIndexOf("."));
	return IMAGE_EXTENSIONS.has(ext);
}

function tooLargeDiff(message: string, isNew = false): HunkDiff {
	return {
		oldLines: [],
		newLines: [{ number: 1, content: message, type: "context" }],
		isBinary: false,
		isNew,
	};
}

async function runGitText(
	cwd: string,
	args: string[],
	timeoutMs = 5000
): Promise<string | null> {
	try {
		const proc = Bun.spawn(["git", ...args], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		let timeout: ReturnType<typeof setTimeout> | null = null;
		const timeoutPromise = new Promise<"timeout">((resolve) => {
			timeout = setTimeout(() => {
				try {
					proc.kill();
				} catch {}
				resolve("timeout");
			}, timeoutMs);
		});
		const result = await Promise.race([
			Promise.all([new Response(proc.stdout).text(), proc.exited]),
			timeoutPromise,
		]);
		if (timeout) clearTimeout(timeout);
		if (result === "timeout") return null;
		const [text, exitCode] = result;
		return exitCode === 0 ? text : null;
	} catch {
		return null;
	}
}

async function getRawGitPatch(
	cwd: string,
	filePath: string,
	staged: boolean
): Promise<string> {
	const args = staged
		? ["diff", "--cached", "--binary", "--find-renames", "--", filePath]
		: ["diff", "--binary", "--find-renames", "--", filePath];
	const patch = (await runGitText(cwd, args, 5000)) ?? "";
	if (!/^new file mode/m.test(patch)) return patch;

	const allArgs = staged
		? ["diff", "--cached", "--binary", "--find-renames"]
		: ["diff", "--binary", "--find-renames"];
	const fullPatch = (await runGitText(cwd, allArgs, 5000)) ?? "";
	return extractPatchForPath(fullPatch, filePath) ?? patch;
}

function createUntrackedPatch(filePath: string, content: string): string {
	const lines = content.split("\n");
	return [
		`diff --git a/${filePath} b/${filePath}`,
		"new file mode 100644",
		"index 0000000..0000000",
		"--- /dev/null",
		`+++ b/${filePath}`,
		`@@ -0,0 +1,${lines.length} @@`,
		...lines.map((line) => `+${line}`),
	].join("\n");
}

function extractPatchForPath(patch: string, filePath: string): string | null {
	if (!patch.trim()) return null;
	const blocks = patch
		.split(/(?=^diff --git )/m)
		.map((block) => block.trimEnd())
		.filter(Boolean);
	for (const block of blocks) {
		const header = block.split("\n", 1)[0] ?? "";
		if (
			header.endsWith(` b/${filePath}`) ||
			block.includes(`\nrename to ${filePath}\n`) ||
			block.includes(`\n+++ b/${filePath}\n`)
		) {
			return `${block}\n`;
		}
	}
	return null;
}

function hasMergeConflictMarkers(content: string): boolean {
	return (
		content.includes("<<<<<<< ") &&
		content.includes("\n=======") &&
		content.includes("\n>>>>>>> ")
	);
}

export async function getHunkDiff(
	cwd: string,
	filePath: string,
	staged: boolean
): Promise<HunkDiff> {
	const requestedPath = resolve(cwd, filePath);
	const rawPatch = await getRawGitPatch(cwd, filePath, staged);
	const deletedPatch = /^(deleted file mode|\+\+\+ \/dev\/null)/m.test(
		rawPatch
	);
	const fullPath = deletedPatch
		? requestedPath
		: await resolveRealAllowedLocalPath(requestedPath);
	if (!fullPath) return tooLargeDiff("Access denied");

	if (isImageFile(filePath)) {
		return {
			oldLines: [],
			newLines: [],
			isBinary: true,
			isNew: true,
			isImage: true,
			imagePath: fullPath,
			rawPatch,
		};
	}

	let currentContent = "";
	if (!deletedPatch) {
		let readAttempts = 0;
		const maxAttempts = 3;
		while (readAttempts < maxAttempts) {
			try {
				const f = Bun.file(fullPath);
				if (f.size > MAX_UNTRACKED_FILE_BYTES) {
					return {
						...tooLargeDiff("File too large to render safely", true),
						rawPatch,
					};
				}
				currentContent = await f.text();
				if (currentContent.includes("\0")) {
					return {
						oldLines: [],
						newLines: [],
						isBinary: true,
						isNew: false,
						rawPatch,
					};
				}
				break;
			} catch {
				readAttempts++;
				if (readAttempts >= maxAttempts) {
					return {
						oldLines: [],
						newLines: [
							{ number: 1, content: "Cannot read file", type: "context" },
						],
						isBinary: false,
						isNew: true,
						rawPatch,
					};
				}
				await new Promise((r) => setTimeout(r, 100));
			}
		}
	}

	const mergeConflictContent = hasMergeConflictMarkers(currentContent)
		? currentContent
		: undefined;

	let oldContent = "";
	let isNew = false;
	try {
		const ref = staged ? `HEAD:${filePath}` : `:${filePath}`;
		const proc = Bun.spawn(["git", "show", ref], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [text, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			proc.exited,
		]);
		if (exitCode === 0) {
			oldContent = text;
		} else {
			isNew = true;
		}
	} catch {
		isNew = true;
	}

	if (deletedPatch) {
		const lines = oldContent.split("\n");
		if (lines.length > MAX_RENDERED_DIFF_LINES) {
			return { ...tooLargeDiff("Diff too large to render safely"), rawPatch };
		}
		for (const line of lines) {
			if (line.length > MAX_RENDERED_LINE_CHARS) {
				return {
					...tooLargeDiff(
						"Diff contains a very long line and cannot render safely"
					),
					rawPatch,
				};
			}
		}
		return {
			oldLines: lines.map((c, i) => ({
				number: i + 1,
				content: c,
				type: "remove" as const,
			})),
			newLines: lines.map(() => ({
				number: null,
				content: "",
				type: "spacer",
			})),
			isBinary: false,
			isNew: false,
			rawPatch,
		};
	}

	if (isNew) {
		const lines = currentContent.split("\n");
		return {
			oldLines: [],
			newLines: lines.map((c, i) => ({
				number: i + 1,
				content: c,
				type: "add" as const,
			})),
			isBinary: false,
			isNew: true,
			rawPatch: rawPatch || createUntrackedPatch(filePath, currentContent),
			mergeConflictContent,
		};
	}

	const oldFileLines = oldContent.split("\n");
	const newFileLines = currentContent.split("\n");
	if (oldFileLines.length + newFileLines.length > MAX_RENDERED_DIFF_LINES) {
		return { ...tooLargeDiff("Diff too large to render safely"), rawPatch };
	}
	let longestLine = 0;
	for (const line of oldFileLines)
		longestLine = Math.max(longestLine, line.length);
	for (const line of newFileLines)
		longestLine = Math.max(longestLine, line.length);
	if (longestLine > MAX_RENDERED_LINE_CHARS) {
		return {
			...tooLargeDiff(
				"Diff contains a very long line and cannot render safely"
			),
			rawPatch,
		};
	}

	interface DiffHunk {
		oldStart: number;
		oldCount: number;
		newStart: number;
		newCount: number;
	}
	const hunks: DiffHunk[] = [];

	try {
		const args = staged
			? ["diff", "--cached", "-U0", "--", filePath]
			: ["diff", "-U0", "--", filePath];
		const diffText = (await runGitText(cwd, args, 5000)) ?? "";

		for (const line of diffText.split("\n")) {
			if (line.startsWith("@@")) {
				const m = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
				if (m) {
					hunks.push({
						oldStart: Number.parseInt(m[1]!, 10),
						oldCount: m[2] ? Number.parseInt(m[2], 10) : 1,
						newStart: Number.parseInt(m[3]!, 10),
						newCount: m[4] ? Number.parseInt(m[4], 10) : 1,
					});
				}
			}
		}
	} catch {}

	const removedRanges: Array<{ start: number; end: number }> = [];
	const addedRanges: Array<{ start: number; end: number }> = [];

	for (const hunk of hunks) {
		if (hunk.oldCount > 0) {
			removedRanges.push({
				start: hunk.oldStart,
				end: hunk.oldStart + hunk.oldCount - 1,
			});
		}
		if (hunk.newCount > 0) {
			addedRanges.push({
				start: hunk.newStart,
				end: hunk.newStart + hunk.newCount - 1,
			});
		}
	}

	const oldLines: DiffLine[] = [];
	const newLines: DiffLine[] = [];
	let oldIdx = 0;
	let newIdx = 0;

	while (oldIdx < oldFileLines.length || newIdx < newFileLines.length) {
		const oldLineNum = oldIdx + 1;
		const newLineNum = newIdx + 1;
		const oldIsRemoved =
			oldIdx < oldFileLines.length &&
			rangeContainsLine(removedRanges, oldLineNum);
		const newIsAdded =
			newIdx < newFileLines.length &&
			rangeContainsLine(addedRanges, newLineNum);

		if (oldIsRemoved && newIsAdded) {
			oldLines.push({
				number: oldLineNum,
				content: oldFileLines[oldIdx] ?? "",
				type: "remove",
			});
			newLines.push({
				number: newLineNum,
				content: newFileLines[newIdx] ?? "",
				type: "add",
			});
			oldIdx++;
			newIdx++;
		} else if (oldIsRemoved) {
			oldLines.push({
				number: oldLineNum,
				content: oldFileLines[oldIdx] ?? "",
				type: "remove",
			});
			newLines.push({ number: null, content: "", type: "spacer" });
			oldIdx++;
		} else if (newIsAdded) {
			oldLines.push({ number: null, content: "", type: "spacer" });
			newLines.push({
				number: newLineNum,
				content: newFileLines[newIdx] ?? "",
				type: "add",
			});
			newIdx++;
		} else if (oldIdx < oldFileLines.length && newIdx < newFileLines.length) {
			oldLines.push({
				number: oldLineNum,
				content: oldFileLines[oldIdx] ?? "",
				type: "context",
			});
			newLines.push({
				number: newLineNum,
				content: newFileLines[newIdx] ?? "",
				type: "context",
			});
			oldIdx++;
			newIdx++;
		} else if (oldIdx < oldFileLines.length) {
			oldLines.push({
				number: oldLineNum,
				content: oldFileLines[oldIdx] ?? "",
				type: "remove",
			});
			newLines.push({ number: null, content: "", type: "spacer" });
			oldIdx++;
		} else {
			oldLines.push({ number: null, content: "", type: "spacer" });
			newLines.push({
				number: newLineNum,
				content: newFileLines[newIdx] ?? "",
				type: "add",
			});
			newIdx++;
		}
	}

	return {
		oldLines,
		newLines,
		isBinary: false,
		isNew: false,
		rawPatch,
		mergeConflictContent,
	};
}

export function gitRoutes() {
	return {
		"/api/git/status": {
			GET: tryRoute(async (req) => {
				const url = new URL(req.url);
				const cwd = safeCwd(url.searchParams.get("cwd"));
				if (!cwd) return badRequest("Missing cwd parameter");
				const nativeProjects = await getNativeGitStatuses([cwd]);
				const nativeStatus = nativeProjects?.[0] ?? null;
				if (nativeStatus) {
					return Response.json(nativeStatus);
				}
				const status = await getStatus(cwd);
				if (!status)
					return Response.json(
						{ error: "Not a git repository" },
						{ status: 404 }
					);
				return Response.json(status);
			}),
		},

		"/api/git/statuses": {
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as { cwds: string[] };
				if (!body.cwds?.length) return Response.json([]);
				const seen = new Set<string>();
				const unique: string[] = [];
				for (const cwd of body.cwds) {
					const safe = safeCwd(cwd);
					if (safe && !seen.has(safe)) {
						seen.add(safe);
						unique.push(safe);
					}
				}
				const nativeStatuses = await getNativeGitStatuses(unique);
				if (nativeStatuses) {
					return Response.json(nativeStatuses);
				}
				const results = await Promise.all(unique.map((cwd) => getStatus(cwd)));
				return Response.json(results.filter(Boolean) as GitProjectStatus[]);
			}),
		},

		"/api/git/diff": {
			GET: tryRoute(async (req) => {
				const params = getDiffParams(req);
				if (!params) return badRequest("Missing cwd or file parameter");
				if (!(await isChangedGitFile(params.cwd, params.file))) {
					return Response.json(
						{ error: "File is not changed" },
						{ status: 404 }
					);
				}
				const diff = await getDiff(params.cwd, params.file, params.staged);
				return Response.json({ diff });
			}),
		},

		"/api/git/full-diff": {
			GET: tryRoute(async (req) => {
				const params = getDiffParams(req);
				if (!params) return badRequest("Missing cwd or file parameter");
				if (!(await isChangedGitFile(params.cwd, params.file))) {
					return Response.json(
						{ error: "File is not changed" },
						{ status: 404 }
					);
				}
				const result = await getHunkDiff(
					params.cwd,
					params.file,
					params.staged
				);
				return Response.json(result);
			}),
		},

		"/api/git/branches": {
			GET: tryRoute(async (req) => {
				const url = new URL(req.url);
				const cwd = safeCwd(url.searchParams.get("cwd"));
				if (!cwd) return badRequest("Missing cwd parameter");
				const branches = await getBranches(cwd);
				return Response.json({ branches });
			}),
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as { cwd?: string; branch?: string };
				const cwd = safeCwd(body.cwd);
				if (!cwd) return badRequest("Missing cwd parameter");
				if (!body.branch) return badRequest("Missing branch parameter");
				const result = await checkoutBranch(cwd, body.branch);
				return Response.json(result, { status: result.ok ? 200 : 400 });
			}),
		},

		"/api/git/log": {
			GET: tryRoute(async (req) => {
				const url = new URL(req.url);
				const cwd = safeCwd(url.searchParams.get("cwd"));
				const limit = safeLimit(url.searchParams.get("limit"), 20, 200);
				if (!cwd) return badRequest("Missing cwd parameter");
				const log = await getLog(cwd, limit);
				return Response.json({ log });
			}),
		},

		"/api/git/graph": {
			GET: tryRoute(async (req) => {
				const url = new URL(req.url);
				const cwd = safeCwd(url.searchParams.get("cwd"));
				const limit = safeLimit(url.searchParams.get("limit"), 50, 500);
				if (!cwd) return badRequest("Missing cwd parameter");
				const nativeCommits = await getNativeGitGraph(cwd, limit);
				if (nativeCommits) {
					return Response.json(nativeCommits);
				}
				const commits = await getGraphLog(cwd, limit);
				return Response.json({ commits, rows: [] });
			}),
		},

		"/api/git/blame": {
			GET: tryRoute(async (req) => {
				const url = new URL(req.url);
				const cwd = safeCwd(url.searchParams.get("cwd"));
				const file = url.searchParams.get("file");
				if (!cwd || !safeFilePath(file))
					return badRequest("Missing cwd or file parameter");
				const blame = await getBlame(cwd, file);
				return Response.json({ blame });
			}),
		},

		"/api/git/file-history": {
			GET: tryRoute(async (req) => {
				const url = new URL(req.url);
				const cwd = safeCwd(url.searchParams.get("cwd"));
				const file = url.searchParams.get("file");
				const limit = safeLimit(url.searchParams.get("limit"), 20, 200);
				if (!cwd || !safeFilePath(file))
					return badRequest("Missing cwd or file parameter");
				const history = await getFileHistory(cwd, file, limit);
				return Response.json({ history });
			}),
		},

		"/api/git/commit-details": {
			GET: tryRoute(async (req) => {
				const url = new URL(req.url);
				const cwd = safeCwd(url.searchParams.get("cwd"));
				const hash = url.searchParams.get("hash");
				if (!cwd || !safeHash(hash))
					return badRequest("Missing cwd or hash parameter");
				const details = await getCommitDetails(cwd, hash);
				return Response.json({ details });
			}),
		},

		"/api/git/stage": {
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as { cwd: string; file?: string };
				const cwd = safeCwd(body.cwd);
				if (!cwd) return badRequest("Missing cwd parameter");
				if (body.file && !safeFilePath(body.file))
					return badRequest("Invalid file parameter");
				const success = body.file
					? await stageFile(cwd, body.file)
					: await stageAll(cwd);
				return Response.json({ success });
			}),
		},

		"/api/git/unstage": {
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as { cwd: string; file?: string };
				const cwd = safeCwd(body.cwd);
				if (!cwd) return badRequest("Missing cwd parameter");
				if (body.file && !safeFilePath(body.file))
					return badRequest("Invalid file parameter");
				const success = body.file
					? await unstageFile(cwd, body.file)
					: await unstageAll(cwd);
				return Response.json({ success });
			}),
		},

		"/api/git/discard-file": {
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as { cwd: string; file?: string };
				const cwd = safeCwd(body.cwd);
				if (!cwd) return badRequest("Missing cwd parameter");
				if (!safeFilePath(body.file))
					return badRequest("Invalid file parameter");
				const result = await discardFileChanges(cwd, body.file);
				return Response.json(result, {
					status: result.success ? 200 : 400,
				});
			}),
		},

		"/api/git/commit": {
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as { cwd: string; message: string };
				const cwd = safeCwd(body.cwd);
				if (!cwd) return badRequest("Missing cwd parameter");
				if (!body.message) return badRequest("Missing message parameter");
				const result = await commit(cwd, body.message);
				return Response.json(result);
			}),
		},

		"/api/git/worktree": {
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as { cwd?: string; name?: string };
				const cwd = safeCwd(body.cwd);
				if (!cwd) return badRequest("Missing cwd parameter");
				const result = await createWorktree(cwd, body.name || "agent-task");
				return Response.json(result, { status: result.ok ? 200 : 400 });
			}),
		},

		"/api/git/worktree/discard": {
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as {
					cwd?: string;
					worktreePath?: string;
					branchName?: string;
				};
				const cwd = safeCwd(body.cwd);
				if (!cwd) return badRequest("Missing cwd parameter");
				if (!body.worktreePath)
					return badRequest("Missing worktreePath parameter");
				if (!body.branchName) return badRequest("Missing branchName parameter");
				const result = await discardWorktree(
					cwd,
					body.worktreePath,
					body.branchName
				);
				return Response.json(result, { status: result.ok ? 200 : 400 });
			}),
		},

		"/api/git/worktree/merge": {
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as {
					cwd?: string;
					worktreePath?: string;
					branchName?: string;
				};
				const cwd = safeCwd(body.cwd);
				if (!cwd) return badRequest("Missing cwd parameter");
				if (!body.worktreePath)
					return badRequest("Missing worktreePath parameter");
				if (!body.branchName) return badRequest("Missing branchName parameter");
				const result = await mergeWorktree(
					cwd,
					body.worktreePath,
					body.branchName
				);
				return Response.json(result, { status: result.ok ? 200 : 400 });
			}),
		},

		"/api/git/watch": {
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as { cwd: string };
				const cwd = safeCwd(body.cwd);
				if (!cwd) return badRequest("Missing cwd parameter");
				watchDirectory(cwd);
				return Response.json({ ok: true });
			}),
		},

		"/api/git/unwatch": {
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as { cwd: string };
				const cwd = safeCwd(body.cwd);
				if (!cwd) return badRequest("Missing cwd parameter");
				unwatchDirectory(cwd);
				return Response.json({ ok: true });
			}),
		},
	};
}
