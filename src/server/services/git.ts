import { resolve } from "node:path";
import {
	isStagedChange,
	isUnstagedTrackedChange,
	isUntrackedChange,
} from "../../features/git/git-file-utils.ts";
import {
	isSafeRelativePath,
	resolveRealAllowedLocalPath,
} from "../security.ts";
import type {
	GitFileEntry,
	GitProjectStatus,
} from "../../features/git/types.ts";

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

export async function getStatus(cwd: string): Promise<GitProjectStatus | null> {
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
				const bracketStart = rest.indexOf("[");
				if (bracketStart !== -1) {
					upstream = rest.slice(0, bracketStart).trim();
					const info = rest.slice(bracketStart + 1, rest.indexOf("]"));
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

export async function getDiff(
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

export async function getBranches(
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

export interface GitCommit {
	hash: string;
	message: string;
	author: string;
	date: string;
	parents: string[];
	refs: string[];
}

export async function getLog(
	cwd: string,
	limit = 20
): Promise<{ hash: string; message: string; author: string; date: string }[]> {
	const result = await run(
		["log", `--max-count=${limit}`, "--format=%h|%s|%an|%ar"],
		cwd
	);
	return parseCommitSummaryLog(result);
}

export async function getGraphLog(
	cwd: string,
	limit = 50
): Promise<GitCommit[]> {
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
			const refs = refsRaw
				.split(",")
				.map((r) => r.trim())
				.filter(Boolean);
			const message = parts[3] || "";
			const author = parts[4] || "";
			const date = parts[5] || "";
			return { hash, message, author, date, parents, refs };
		});
}

export interface BlameLine {
	hash: string;
	author: string;
	date: string;
	lineNum: number;
	content: string;
}

export async function getBlame(
	cwd: string,
	filePath: string
): Promise<BlameLine[]> {
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

export async function getFileHistory(
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

export interface CommitFile {
	path: string;
	status: string; // A, M, D, R, etc.
	additions: number;
	deletions: number;
}

export interface CommitDetails {
	hash: string;
	message: string;
	author: string;
	date: string;
	files: CommitFile[];
}

export async function getCommitDetails(
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

export async function stageFile(
	cwd: string,
	filePath: string
): Promise<boolean> {
	const result = await run(["add", "--", filePath], cwd);
	return result !== null;
}

export async function stageAll(cwd: string): Promise<boolean> {
	const result = await run(["add", "-A"], cwd);
	return result !== null;
}

export async function unstageFile(
	cwd: string,
	filePath: string
): Promise<boolean> {
	const result = await run(["reset", "HEAD", "--", filePath], cwd);
	return result !== null;
}

export async function unstageAll(cwd: string): Promise<boolean> {
	const result = await run(["reset", "HEAD"], cwd);
	return result !== null;
}

export async function commit(
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
