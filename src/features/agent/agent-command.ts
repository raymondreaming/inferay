import { existsSync, readdirSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { isNonEmptyString } from "../../lib/data.ts";
import type { ChatAgentKind } from "../agents/agents.ts";

const isWin = process.platform === "win32";
const homeDir =
	process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH || null;

function findInNvmVersions(binaryName: string): string | null {
	const home = homeDir;
	if (!home) return null;
	const versionsDir = join(home, ".nvm", "versions", "node");
	try {
		const versions = readdirSync(versionsDir);
		for (const v of versions.sort().reverse()) {
			const candidate = join(versionsDir, v, "bin", binaryName);
			if (existsSync(candidate)) return candidate;
		}
	} catch {}
	return null;
}

function getAgentPathCandidates(kind: ChatAgentKind): string[] {
	const nvmBin = process.env.NVM_BIN;
	const isClaude = kind === "claude";
	const binary = isClaude ? "claude" : "codex";
	const candidates = isClaude
		? [
				process.env.CLAUDE_PATH,
				homeDir ? join(homeDir, ".local", "bin", binary) : null,
				homeDir ? join(homeDir, ".bun", "bin", binary) : null,
				nvmBin ? join(nvmBin, binary) : null,
				findInNvmVersions(binary),
				homeDir ? join(homeDir, ".npm-global", "bin", binary) : null,
				"/usr/local/bin/claude",
				"/opt/homebrew/bin/claude",
			]
		: [
				process.env.CODEX_PATH,
				nvmBin ? join(nvmBin, binary) : null,
				findInNvmVersions(binary),
				homeDir ? join(homeDir, ".npm-global", "bin", binary) : null,
				homeDir ? join(homeDir, ".local", "bin", binary) : null,
				homeDir ? join(homeDir, ".bun", "bin", binary) : null,
				"/opt/homebrew/bin/codex",
				"/usr/local/bin/codex",
			];

	return candidates.flatMap((pathname) => {
		if (!isNonEmptyString(pathname)) return [];
		if (!isWin || pathname.endsWith(".cmd") || pathname.endsWith(".exe")) {
			return [pathname];
		}
		return [`${pathname}.cmd`];
	});
}

export function resolveAgentBinary(kind: ChatAgentKind): string {
	for (const candidate of getAgentPathCandidates(kind)) {
		if (existsSync(candidate)) {
			return candidate;
		}
		if (kind === "claude" && isWin && candidate.endsWith(".cmd")) {
			const exeCandidate = candidate.replace(/\.cmd$/, ".exe");
			if (existsSync(exeCandidate)) return exeCandidate;
		}
	}
	const binary = kind === "claude" ? "claude" : "codex";
	return isWin ? `${binary}.cmd` : binary;
}

export function createAgentEnv(kind: ChatAgentKind): Record<string, string> {
	const env = { ...process.env } as Record<string, string>;
	if (kind === "claude") delete env.CLAUDECODE;
	const pathEntries = (env.PATH || "").split(delimiter).filter(Boolean);
	const pathEntrySet = new Set(pathEntries);
	for (const candidate of getAgentPathCandidates(kind)) {
		const candidateDir = dirname(candidate);
		if (candidateDir && !pathEntrySet.has(candidateDir)) {
			pathEntries.unshift(candidateDir);
			pathEntrySet.add(candidateDir);
		}
	}
	if (pathEntries.length > 0) {
		env.PATH = pathEntries.join(delimiter);
	}

	return env;
}

const availabilityCache: Partial<Record<ChatAgentKind, boolean>> = {};

export async function hasAgentCli(kind: ChatAgentKind): Promise<boolean> {
	const cached = availabilityCache[kind];
	if (cached != null) return cached;

	for (const candidate of getAgentPathCandidates(kind)) {
		if (existsSync(candidate)) {
			availabilityCache[kind] = true;
			return true;
		}
	}

	const findCmd = isWin ? "where" : "which";
	const binary = kind === "claude" ? "claude" : "codex";
	try {
		await Bun.$`${findCmd} ${binary}`.quiet();
		availabilityCache[kind] = true;
	} catch {
		availabilityCache[kind] = false;
	}
	return availabilityCache[kind]!;
}
