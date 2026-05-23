import type { GitFileEntry, GitProjectStatus } from "./types.ts";
import {
	isStagedChange,
	isUnstagedTrackedChange,
	isUntrackedChange,
} from "../../features/git/git-file-utils.ts";

export interface ChangeCheckpoint {
	id: string;
	cwd: string;
	timestamp: number;
	signature: string;
}

export interface DiffTextEntry {
	file: GitFileEntry;
	diff: string;
}

export function checkpointKey(cwd: string) {
	return `git-change-checkpoint:${cwd}`;
}

export function createChangeSignature(files: GitFileEntry[]) {
	return files
		.map((file) =>
			[file.staged ? "staged" : "unstaged", file.status, file.path].join(":")
		)
		.sort()
		.join("|");
}

export function buildReviewPrompt(
	project: GitProjectStatus,
	diffs: DiffTextEntry[]
) {
	return [
		`Review the current changes in ${project.name}.`,
		"Focus on correctness, regressions, missing tests, and risky implementation choices.",
		"Return prioritized findings with file paths and concrete fixes.",
		"",
		diffs
			.map(({ file, diff }) =>
				[
					`# ${file.staged ? "Staged" : "Unstaged"} ${file.status} ${file.path}`,
					diff.trim(),
				]
					.filter(Boolean)
					.join("\n")
			)
			.join("\n\n"),
	].join("\n");
}

export function buildSummaryPrompt(
	project: GitProjectStatus,
	reviewPrompt: string
) {
	return [
		`Summarize the current worktree changes in ${project.name}.`,
		"Keep it short: 4-6 bullets, grouped by intent. Mention risk or missing tests only if obvious.",
		"",
		reviewPrompt,
	].join("\n");
}

export function buildRepoExplainPrompt(project: GitProjectStatus) {
	return [
		`Explain the repository ${project.name}.`,
		"Start by inspecting the project structure and key package files.",
		"Then summarize what this repo does, the main architecture, and the highest-value next improvements.",
	].join("\n");
}

export function buildCommitMessage(project: GitProjectStatus) {
	const staged = project.files.filter(isStagedChange);
	const modified = project.files.filter(isUnstagedTrackedChange);
	const untracked = project.files.filter(isUntrackedChange);
	const parts = [
		staged.length ? `${staged.length} staged` : null,
		modified.length ? `${modified.length} modified` : null,
		untracked.length ? `${untracked.length} new` : null,
	].filter(Boolean);
	const mainFile = project.files[0]?.path;
	const name = mainFile?.split("/").pop() || mainFile;
	return project.files.length === 1 && name
		? `chore: update ${name}`
		: `chore: update ${project.name}${parts.length ? ` (${parts.join(", ")})` : ""}`;
}
