import { type FSWatcher, watch } from "node:fs";
import { resolve } from "node:path";
import {
	isStagedChange,
	isUnstagedTrackedChange,
	isUntrackedChange,
} from "../../features/git/git-file-utils.ts";
import type {
	GitFileEntry,
	GitProjectStatus,
} from "../../features/git/types.ts";
import { rangeContainsLine } from "../../lib/data.ts";
import { badRequest, tryRoute } from "../../lib/route-helpers.ts";
import {
	isSafeRelativePath,
	resolveAllowedChildPath,
	resolveAllowedLocalPath,
	resolveRealAllowedLocalPath,
} from "../security.ts";
import { runNativeCore } from "../services/native-core.ts";
import { broadcastAll } from "../ws.ts";

async function run(
	args: string[],
	cwd: string,
	timeoutMs?: number
): Promise<string | null> {
	try {
		const proc = Bun.spawn(["git", ...args], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		let timeout: ReturnType<typeof setTimeout> | null = null;
		const timeoutPromise =
			timeoutMs == null
				? null
				: new Promise<"timeout">((resolve) => {
						timeout = setTimeout(() => {
							try {
								proc.kill();
							} catch {}
							resolve("timeout");
						}, timeoutMs);
					});
		const result = await Promise.race([
			Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]),
			...(timeoutPromise ? [timeoutPromise] : []),
		]);
		if (timeout) clearTimeout(timeout);
		if (result === "timeout") return null;
		const [text, _stderr, exitCode] = result;
		if (exitCode !== 0) return null;
		return text;
	} catch {
		return null;
	}
}

// Same as run but with a timeout to prevent server hangs
async function runSafe(
	args: string[],
	cwd: string,
	timeoutMs = 5000
): Promise<string | null> {
	return run(args, cwd, timeoutMs);
}

async function isGitRepo(cwd: string): Promise<boolean> {
	const result = await run(["rev-parse", "--git-dir"], cwd);
	return result !== null;
}

function parseCommitSummaryLog(result: string | null) {
	if (!result) return [];
	return result
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [hash = "", message = "", author = "", date = ""] = line.split("|");
			return { hash, message, author, date };
		});
}

async function getStatus(cwd: string): Promise<GitProjectStatus | null> {
	if (!(await isGitRepo(cwd))) return null;

	const raw = await run(
		["status", "--porcelain=v1", "-b", "--untracked-files=all"],
		cwd
	);
	if (raw === null) return null;

	const lines = raw.split("\n").filter(Boolean);
	let branch = "HEAD";
	let upstream: string | null = null;
	let ahead = 0;
	let behind = 0;
	const files: GitFileEntry[] = [];

	for (const line of lines) {
		if (line.startsWith("## ")) {
			const branchLine = line.slice(3);
			const dotDot = branchLine.indexOf("...");
			if (dotDot !== -1) {
				branch = branchLine.slice(0, dotDot);
				const rest = branchLine.slice(dotDot + 3);
				const bracketMatch = /^(.*?)\[(.*?)]/.exec(rest);
				if (bracketMatch) {
					upstream = bracketMatch[1]?.trim() ?? "";
					const info = bracketMatch[2] ?? "";
					const aheadMatch = info.match(/ahead (\d+)/);
					const behindMatch = info.match(/behind (\d+)/);
					if (aheadMatch) ahead = Number(aheadMatch[1]);
					if (behindMatch) behind = Number(behindMatch[1]);
				} else {
					upstream = rest.trim();
				}
			} else {
				branch = branchLine.split(" ")[0] || "HEAD";
			}
			continue;
		}

		const x = line[0] ?? " "; // index (staged)
		const y = line[1] ?? " "; // worktree (unstaged)
		const filePath = line.slice(3);

		// Handle renames: "R  old -> new"
		const arrowIdx = filePath.indexOf(" -> ");
		const actualPath =
			arrowIdx !== -1 ? filePath.slice(arrowIdx + 4) : filePath;
		const origPath = arrowIdx !== -1 ? filePath.slice(0, arrowIdx) : undefined;

		// Staged changes (index column)
		if (x !== " " && x !== "?") {
			files.push({
				status: x,
				staged: true,
				path: actualPath,
				originalPath: origPath,
			});
		}

		// Unstaged changes (worktree column)
		if (y !== " " && y !== "?") {
			files.push({
				status: y,
				staged: false,
				path: actualPath,
				originalPath: origPath,
			});
		}

		// Untracked files
		if (x === "?" && y === "?") {
			files.push({
				status: "?",
				staged: false,
				path: actualPath,
			});
		}
	}

	const stagedCount = files.filter(isStagedChange).length;
	const unstagedCount = files.filter(isUnstagedTrackedChange).length;
	const untrackedCount = files.filter(isUntrackedChange).length;
	const name = cwd.split("/").pop() || cwd;
	const diffStats = await getWorkingTreeNumstat(cwd);
	for (const file of files) {
		const stats = diffStats.get(
			`${file.staged ? "staged" : "unstaged"}:${file.path}`
		);
		if (stats) {
			file.additions = stats.additions;
			file.deletions = stats.deletions;
		}
	}

	return {
		cwd,
		name,
		branch,
		upstream,
		ahead,
		behind,
		stagedCount,
		unstagedCount,
		untrackedCount,
		files,
	};
}

async function getWorkingTreeNumstat(cwd: string) {
	const stats = new Map<string, { additions: number; deletions: number }>();
	await addNumstatEntries(stats, cwd, false);
	await addNumstatEntries(stats, cwd, true);
	return stats;
}

async function addNumstatEntries(
	stats: Map<string, { additions: number; deletions: number }>,
	cwd: string,
	staged: boolean
) {
	const result = await runSafe(
		staged ? ["diff", "--cached", "--numstat"] : ["diff", "--numstat"],
		cwd,
		3000
	);
	if (!result) return;
	const prefix = staged ? "staged" : "unstaged";
	for (const line of result.split("\n")) {
		if (!line) continue;
		const parts = line.split("\t");
		if (parts.length < 3) continue;
		const additions =
			parts[0] === "-" ? 0 : Number.parseInt(parts[0]!, 10) || 0;
		const deletions =
			parts[1] === "-" ? 0 : Number.parseInt(parts[1]!, 10) || 0;
		const rawPath = parts[parts.length - 1]!;
		stats.set(`${prefix}:${normalizeNumstatPath(rawPath)}`, {
			additions,
			deletions,
		});
	}
}

export function normalizeNumstatPath(path: string) {
	const arrowIdx = path.indexOf(" => ");
	if (arrowIdx === -1) return path;
	const braceStart = path.lastIndexOf("{", arrowIdx);
	const braceEnd = path.indexOf("}", arrowIdx);
	if (braceStart !== -1 && braceEnd !== -1) {
		return (
			path.slice(0, braceStart) +
			path.slice(arrowIdx + 4, braceEnd) +
			path.slice(braceEnd + 1)
		).replace(/^\/+/, "");
	}
	const suffix = path.slice(arrowIdx + 4);
	return suffix.replace(/^\/+/, "");
}

async function getDiff(
	cwd: string,
	filePath: string,
	staged: boolean
): Promise<string> {
	if (!isSafeRelativePath(filePath) || !(await isGitRepo(cwd))) return "";
	const args = staged
		? ["diff", "--cached", "--", filePath]
		: ["diff", "--", filePath];

	const result = await runSafe(args, cwd);

	// For untracked files, read the file content and format as a diff
	if (result === null || result.trim() === "") {
		const status = await runSafe(
			["status", "--porcelain", "--", filePath],
			cwd
		);
		if (!status?.split("\n").some((line) => line.startsWith("?? "))) {
			return "";
		}
		const fullPath = await resolveRealAllowedLocalPath(resolve(cwd, filePath));
		if (!fullPath) return "";
		try {
			const file = Bun.file(fullPath);
			if ((await file.exists()) && file.size <= 120_000) {
				const content = await file.text();
				if (content.includes("\0")) return "";
				const lines = content.split("\n");
				const diffLines = lines.map((l) => `+${l}`);
				return [
					`--- /dev/null`,
					`+++ b/${filePath}`,
					`@@ -0,0 +1,${lines.length} @@`,
					...diffLines,
				].join("\n");
			}
		} catch {}
		return "";
	}

	return result;
}

async function getBranches(
	cwd: string
): Promise<{ name: string; current: boolean }[]> {
	const result = await run(
		["branch", "--format=%(HEAD) %(refname:short)"],
		cwd
	);
	if (!result) return [];

	return result
		.split("\n")
		.filter(Boolean)
		.map((line) => ({
			current: line.startsWith("*"),
			name: line.slice(2).trim(),
		}));
}

async function checkoutBranch(
	cwd: string,
	branchName: string
): Promise<{ ok: boolean; branch?: string; error?: string }> {
	const branches = await getBranches(cwd);
	if (!branches.some((branch) => branch.name === branchName)) {
		return { ok: false, error: "Branch not found" };
	}
	try {
		const proc = Bun.spawn(["git", "checkout", branchName], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stderr, exitCode] = await Promise.all([
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		if (exitCode !== 0) {
			return {
				ok: false,
				error: stderr.trim() || `Unable to checkout ${branchName}`,
			};
		}
		const current =
			(await run(["rev-parse", "--abbrev-ref", "HEAD"], cwd, 5000))?.trim() ||
			branchName;
		return { ok: true, branch: current };
	} catch {
		return { ok: false, error: `Unable to checkout ${branchName}` };
	}
}

interface GitCommit {
	hash: string;
	message: string;
	author: string;
	date: string;
	parents: string[];
	refs: string[];
}

async function getLog(
	cwd: string,
	limit = 20
): Promise<{ hash: string; message: string; author: string; date: string }[]> {
	const result = await run(
		["log", `--max-count=${limit}`, "--format=%h|%s|%an|%ar"],
		cwd
	);
	return parseCommitSummaryLog(result);
}

async function getGraphLog(cwd: string, limit = 50): Promise<GitCommit[]> {
	// Format: hash|parents|refs|subject|author|date
	// %h = abbreviated hash, %p = parent hashes, %D = ref names, %s = subject, %an = author, %ar = relative date
	const result = await run(
		["log", `--max-count=${limit}`, "--format=%h|%p|%D|%s|%an|%ar", "--all"],
		cwd
	);
	if (!result) return [];

	return result
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const parts = line.split("|");
			const hash = parts[0] || "";
			const parents = (parts[1] || "").split(" ").filter(Boolean);
			const refsRaw = parts[2] || "";
			const refs = refsRaw.split(",").flatMap((ref) => {
				const trimmed = ref.trim();
				return trimmed ? [trimmed] : [];
			});
			const message = parts[3] || "";
			const author = parts[4] || "";
			const date = parts[5] || "";
			return { hash, message, author, date, parents, refs };
		});
}

interface BlameLine {
	hash: string;
	author: string;
	date: string;
	lineNum: number;
	content: string;
}

async function getBlame(cwd: string, filePath: string): Promise<BlameLine[]> {
	// Use --porcelain for machine-readable output
	const result = await runSafe(
		["blame", "--porcelain", "--", filePath],
		cwd,
		10000
	);
	if (!result) return [];

	const lines: BlameLine[] = [];
	const commits = new Map<string, { author: string; date: string }>();
	const rawLines = result.split("\n");

	let i = 0;
	while (i < rawLines.length) {
		const headerLine = rawLines[i]!;
		// Header format: <hash> <orig-line> <final-line> [<num-lines>]
		const headerMatch = headerLine.match(/^([a-f0-9]{40}) \d+ (\d+)/);
		if (!headerMatch) {
			i++;
			continue;
		}

		const hash = headerMatch[1]!;
		const lineNum = Number.parseInt(headerMatch[2]!, 10);
		i++;

		// Read commit info if this is first time seeing this commit
		if (!commits.has(hash)) {
			let author = "";
			let date = "";

			while (i < rawLines.length && !rawLines[i]!.startsWith("\t")) {
				const line = rawLines[i]!;
				if (line.startsWith("author ")) {
					author = line.slice(7);
				} else if (line.startsWith("author-time ")) {
					const timestamp = Number.parseInt(line.slice(12), 10);
					const d = new Date(timestamp * 1000);
					date = d.toLocaleDateString("en-US", {
						month: "short",
						day: "numeric",
						year: "numeric",
					});
				}
				i++;
			}

			commits.set(hash, { author, date });
		} else {
			// Skip to the content line
			while (i < rawLines.length && !rawLines[i]!.startsWith("\t")) {
				i++;
			}
		}

		// Content line starts with tab
		const content = rawLines[i]?.slice(1) ?? "";
		i++;

		const commitInfo = commits.get(hash)!;
		lines.push({
			hash: hash.slice(0, 7),
			author: commitInfo.author,
			date: commitInfo.date,
			lineNum,
			content,
		});
	}

	return lines;
}

async function getFileHistory(
	cwd: string,
	filePath: string,
	limit = 20
): Promise<{ hash: string; message: string; author: string; date: string }[]> {
	const result = await run(
		[
			"log",
			`--max-count=${limit}`,
			"--format=%h|%s|%an|%ar",
			"--follow",
			"--",
			filePath,
		],
		cwd
	);
	return parseCommitSummaryLog(result);
}

interface CommitFile {
	path: string;
	status: string; // A, M, D, R, etc.
	additions: number;
	deletions: number;
}

interface CommitDetails {
	hash: string;
	message: string;
	author: string;
	date: string;
	files: CommitFile[];
}

async function getCommitDetails(
	cwd: string,
	hash: string
): Promise<CommitDetails | null> {
	// Get commit info
	const info = await run(["log", "-1", "--format=%H|%s|%an|%ar", hash], cwd);
	if (!info) return null;

	const [fullHash = "", message = "", author = "", date = ""] = info
		.trim()
		.split("|");

	const files: CommitFile[] = [];

	// First get numstat for additions/deletions
	const numstatResult = await run(
		["diff-tree", "--no-commit-id", "-r", "--numstat", hash],
		cwd
	);
	const statsMap = new Map<string, { additions: number; deletions: number }>();
	if (numstatResult) {
		for (const line of numstatResult.split("\n").filter(Boolean)) {
			const parts = line.split("\t");
			if (parts.length >= 3) {
				const additions =
					parts[0] === "-" ? 0 : Number.parseInt(parts[0]!, 10) || 0;
				const deletions =
					parts[1] === "-" ? 0 : Number.parseInt(parts[1]!, 10) || 0;
				const path = parts[2]!;
				statsMap.set(path, { additions, deletions });
			}
		}
	}

	// Get name-status for status codes
	const statusResult = await run(
		["diff-tree", "--no-commit-id", "-r", "--name-status", hash],
		cwd
	);
	if (statusResult) {
		for (const line of statusResult.split("\n").filter(Boolean)) {
			const parts = line.split("\t");
			if (parts.length >= 2) {
				const status = parts[0]!.charAt(0); // M, A, D, R, etc.
				const path = parts[parts.length - 1]!; // Last part is the path (handles renames)
				const stats = statsMap.get(path) || { additions: 0, deletions: 0 };
				files.push({
					path,
					status,
					additions: stats.additions,
					deletions: stats.deletions,
				});
			}
		}
	}

	return {
		hash: fullHash,
		message,
		author,
		date,
		files,
	};
}

async function stageFile(cwd: string, filePath: string): Promise<boolean> {
	const result = await run(["add", "--", filePath], cwd);
	return result !== null;
}

async function stageAll(cwd: string): Promise<boolean> {
	const result = await run(["add", "-A"], cwd);
	return result !== null;
}

async function unstageFile(cwd: string, filePath: string): Promise<boolean> {
	const result = await run(["reset", "HEAD", "--", filePath], cwd);
	return result !== null;
}

async function unstageAll(cwd: string): Promise<boolean> {
	const result = await run(["reset", "HEAD"], cwd);
	return result !== null;
}

async function commit(
	cwd: string,
	message: string
): Promise<{ success: boolean; hash?: string; error?: string }> {
	if (!message.trim()) {
		return { success: false, error: "Commit message is required" };
	}

	const result = await run(["commit", "-m", message], cwd, 30_000);
	if (result === null) {
		return { success: false, error: "Commit failed" };
	}

	// Extract commit hash from output
	const hashMatch = result.match(/\[[\w-]+ ([a-f0-9]+)\]/);
	return { success: true, hash: hashMatch?.[1] };
}

interface NativeGitFileEntry {
	status: string;
	staged: boolean;
	path: string;
	originalPath?: string;
}

interface NativeGitStatusResult {
	cwd: string;
	name: string;
	branch: string;
	upstream: string | null;
	ahead: number;
	behind: number;
	stagedCount: number;
	unstagedCount: number;
	untrackedCount: number;
	files: NativeGitFileEntry[];
}

interface NativeGraphCommit {
	hash: string;
	message: string;
	author: string;
	authorEmail: string;
	authorAvatarUrl: string;
	date: string;
	parents: string[];
	refs: string[];
	column: number;
	color: string;
}

interface NativeGraphRail {
	column: number;
	color: string;
}

interface NativeGraphTransition {
	fromColumn: number;
	toColumn: number;
	color: string;
}

interface NativeGraphRow {
	row: number;
	rails: NativeGraphRail[];
	transitions: NativeGraphTransition[];
}

interface NativeGitStatusesResponse {
	op: "git_statuses";
	projects: NativeGitStatusResult[];
}

interface NativeGitGraphResponse {
	op: "git_graph";
	commits: NativeGraphCommit[];
	rows: NativeGraphRow[];
}

async function getNativeGitStatuses(
	cwds: string[]
): Promise<NativeGitStatusResult[] | null> {
	if (!cwds.length) return [];
	const result = await runNativeCore<
		{ op: "git_statuses"; cwds: string[] },
		NativeGitStatusesResponse
	>(
		{
			op: "git_statuses",
			cwds,
		},
		{ timeoutMs: 1500 }
	);
	return result?.projects ?? null;
}

async function getNativeGitGraph(
	cwd: string,
	limit: number
): Promise<{ commits: NativeGraphCommit[]; rows: NativeGraphRow[] } | null> {
	const result = await runNativeCore<
		{ op: "git_graph"; cwd: string; limit: number },
		NativeGitGraphResponse
	>({
		op: "git_graph",
		cwd,
		limit,
	});
	return result ? { commits: result.commits, rows: result.rows } : null;
}

interface WatchedDir {
	watcher: FSWatcher;
	lastEvent: number;
}

const watchedDirs = new Map<string, WatchedDir>();
const FILE_WATCH_DEBOUNCE_MS = 300;

function watchDirectory(cwd: string): void {
	if (watchedDirs.has(cwd)) return;

	try {
		const watcher = watch(cwd, { recursive: true }, (eventType, filename) => {
			if (!filename) return;
			if (
				filename.startsWith(".") ||
				filename.includes("node_modules") ||
				filename.includes(".git") ||
				filename.startsWith("data/") ||
				filename.endsWith(".json")
			) {
				return;
			}
			if (!filename.match(/\.(ts|tsx|js|jsx|css|html|md)$/)) return;

			const watched = watchedDirs.get(cwd);
			if (!watched) return;

			const now = Date.now();
			if (now - watched.lastEvent < FILE_WATCH_DEBOUNCE_MS) return;
			watched.lastEvent = now;

			broadcastAll(
				JSON.stringify({
					type: "file:changed",
					cwd,
					file: filename,
					eventType,
				})
			);
		});

		watchedDirs.set(cwd, { watcher, lastEvent: 0 });
	} catch (err) {
		console.error(`[FileWatcher] Failed to watch ${cwd}:`, err);
	}
}

function unwatchDirectory(cwd: string): void {
	const watched = watchedDirs.get(cwd);
	if (watched) {
		watched.watcher.close();
		watchedDirs.delete(cwd);
	}
}

export interface GitDiffRequestParams {
	cwd: string;
	file: string;
	staged: boolean;
}

function forbidden(message = "Path is outside allowed local roots") {
	return Response.json({ error: message }, { status: 403 });
}

export function getDiffParams(req: Request): GitDiffRequestParams | null {
	const url = new URL(req.url);
	const cwd = safeCwd(url.searchParams.get("cwd"));
	const file = url.searchParams.get("file");
	if (!cwd || !safeFilePath(file)) return null;
	return {
		cwd,
		file,
		staged: url.searchParams.get("staged") === "true",
	};
}

function safeCwd(value: string | null | undefined): string | null {
	return typeof value === "string" && value.trim()
		? resolveAllowedLocalPath(value)
		: null;
}

function safeFilePath(value: string | null | undefined): value is string {
	return typeof value === "string" && isSafeRelativePath(value);
}

export function safeHash(value: string | null | undefined): value is string {
	return typeof value === "string" && /^[a-f0-9]{7,40}$/i.test(value);
}

export function safeLimit(
	value: string | null,
	fallback: number,
	max: number
): number {
	const parsed = Number(value ?? fallback);
	return Number.isFinite(parsed)
		? Math.min(Math.max(Math.trunc(parsed), 1), max)
		: fallback;
}

async function isChangedGitFile(
	cwd: string,
	filePath: string
): Promise<boolean> {
	const status = await getStatus(cwd);
	return Boolean(status?.files.some((file) => file.path === filePath));
}

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

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
	const blocks = patch.split(/(?=^diff --git )/m).flatMap((block) => {
		const trimmed = block.trimEnd();
		return trimmed ? [trimmed] : [];
	});
	const fileMarkerRegex = new RegExp(
		`\\n(?:rename to |\\+\\+\\+ b/)${escapeRegExp(filePath)}\\n`
	);
	for (const block of blocks) {
		const header = block.split("\n", 1)[0] ?? "";
		if (header.endsWith(` b/${filePath}`) || fileMarkerRegex.test(block)) {
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
				if (/\0/.test(currentContent)) {
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
				if (nativeStatuses?.length === unique.length) {
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

		"/api/git/file-with-diff": {
			GET: tryRoute(async (req) => {
				const params = getDiffParams(req);
				if (!params) return badRequest("Missing cwd or file parameter");
				if (!(await isChangedGitFile(params.cwd, params.file))) {
					return Response.json(
						{ error: "File is not changed" },
						{ status: 404 }
					);
				}
				const { cwd, file, staged } = params;
				const childPath = resolveAllowedChildPath(cwd, file);
				const fullPath = childPath
					? await resolveRealAllowedLocalPath(childPath)
					: null;
				if (!fullPath) return forbidden();

				if (isImageFile(file)) {
					return Response.json({
						isImage: true,
						imagePath: fullPath,
						lines: [],
					});
				}

				let content: string;
				try {
					const f = Bun.file(fullPath);
					if (f.size > 500_000)
						return Response.json({ error: "File too large", lines: [] });
					content = await f.text();
					if (content.includes("\0"))
						return Response.json({ error: "Binary file", lines: [] });
				} catch {
					return Response.json({ error: "Cannot read file", lines: [] });
				}

				const addedLines = new Set<number>();
				try {
					const args = staged
						? ["git", "diff", "--cached", "-U0", "--", file]
						: ["git", "diff", "-U0", "--", file];
					const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
					const diffText = await new Response(proc.stdout).text();

					let lineNum = 0;
					for (const line of diffText.split("\n")) {
						if (line.startsWith("@@")) {
							const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
							if (m) lineNum = Number.parseInt(m[1]!, 10);
							continue;
						}
						if (line.startsWith("+") && !line.startsWith("+++")) {
							addedLines.add(lineNum++);
						} else if (line.startsWith("-") && !line.startsWith("---")) {
						} else if (!line.startsWith("\\")) {
							lineNum++;
						}
					}
				} catch {}

				const fileLines = content.split("\n");
				const lines = fileLines.map((text, i) => ({
					number: i + 1,
					content: text,
					type: addedLines.has(i + 1) ? "add" : "context",
				}));

				return Response.json({ lines });
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
				return Response.json(await checkoutBranch(cwd, body.branch));
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
