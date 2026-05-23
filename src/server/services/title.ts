import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runAgentOnce } from "./agent-once.ts";

const execFileAsync = promisify(execFile);

function fallbackTitle(userMessage: string): string {
	const line = userMessage.trim().split("\n")[0] ?? "";
	return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

export async function generateTitle(userMessage: string): Promise<string> {
	const result = await runAgentOnce({
		agentKind: "claude",
		cwd: process.cwd(),
		model: "claude-haiku-4-5",
		timeoutMs: 20_000,
		prompt: `Generate a concise title (max 6 words) that summarizes what this chat is about. Output ONLY the title, nothing else.\n\nUser message:\n${userMessage.slice(0, 500)}`,
	});

	if (!result) return fallbackTitle(userMessage);
	return result.replace(/^["']|["']$/g, "");
}

async function getStagedDiff(cwd: string): Promise<string> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["diff", "--cached", "--stat"],
			{ cwd, encoding: "utf-8", timeout: 10000, maxBuffer: 512 * 1024 }
		);
		const stat = stdout.trim();
		if (!stat) return "";

		const { stdout: diff } = await execFileAsync("git", ["diff", "--cached"], {
			cwd,
			encoding: "utf-8",
			timeout: 10000,
			maxBuffer: 512 * 1024,
		});
		return diff;
	} catch {
		return "";
	}
}

export async function generateCommitMessage(
	cwd: string
): Promise<string | null> {
	const diff = await getStagedDiff(cwd);
	if (!diff) return null;

	const truncatedDiff =
		diff.length > 8000 ? `${diff.slice(0, 8000)}\n\n[diff truncated...]` : diff;

	return runAgentOnce({
		agentKind: "claude",
		cwd,
		model: "claude-haiku-4-5",
		timeoutMs: 30_000,
		prompt: `You are a git commit message generator. Based on the following staged diff, write a concise commit message.

Rules:
- First line: imperative summary, max 72 chars (e.g. "Add user auth flow", "Fix sidebar overflow bug")
- If needed, add a blank line then 1-3 bullet points explaining key changes
- Focus on WHAT changed and WHY, not HOW
- Be specific but brief
- Output ONLY the commit message, no quotes or prefixes

Staged diff:
${truncatedDiff}`,
	});
}
