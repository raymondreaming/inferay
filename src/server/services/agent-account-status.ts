import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type AgentAccountProviderStatus,
	buildAgentAccountStatus,
} from "../../features/agents/agent-account-status.ts";
import type { ChatAgentKind } from "../../features/agents/agents.ts";
import {
	createAgentEnv,
	hasAgentCli,
	resolveAgentBinary,
} from "../../features/terminal/terminal-command.ts";

const HOME = homedir();

const AUTH_CONFIG_CANDIDATES: Record<ChatAgentKind, string[]> = {
	claude: [
		join(HOME, ".claude.json"),
		join(HOME, ".claude"),
		join(HOME, ".config", "claude"),
	],
	codex: [
		join(HOME, ".codex", "auth.json"),
		join(HOME, ".codex", "config.toml"),
		join(HOME, ".config", "codex"),
	],
};

const USAGE_SIGNALS: Record<ChatAgentKind, string[]> = {
	claude: [
		"Claude Code exposes interactive /cost usage details.",
		"Machine-readable rate-limit reset data is not exposed locally.",
	],
	codex: [
		"Codex CLI account usage is handled by the local CLI.",
		"Machine-readable usage and rate-limit reset data is not exposed locally.",
	],
};

const LABELS: Record<ChatAgentKind, string> = {
	claude: "Claude",
	codex: "Codex",
};

function existingPaths(paths: readonly string[]): string[] {
	return paths.filter((path) => existsSync(path));
}

function firstLine(value: string): string | null {
	const line = value
		.split(/\r?\n/)
		.map((item) => item.trim())
		.find(Boolean);
	return line ?? null;
}

async function readCliVersion(kind: ChatAgentKind): Promise<string | null> {
	const binary = resolveAgentBinary(kind);
	try {
		const proc = Bun.spawnSync([binary, "--version"], {
			env: createAgentEnv(kind),
			stdout: "pipe",
			stderr: "pipe",
		});
		if (proc.exitCode !== 0) return null;
		return (
			firstLine(new TextDecoder().decode(proc.stdout)) ??
			firstLine(new TextDecoder().decode(proc.stderr))
		);
	} catch {
		return null;
	}
}

async function providerStatus(
	kind: ChatAgentKind
): Promise<AgentAccountProviderStatus> {
	const installed = await hasAgentCli(kind);
	const binaryPath = resolveAgentBinary(kind);
	return buildAgentAccountStatus({
		kind,
		label: LABELS[kind],
		installed,
		binaryPath,
		version: installed ? await readCliVersion(kind) : null,
		authConfigPaths: installed
			? existingPaths(AUTH_CONFIG_CANDIDATES[kind])
			: [],
		usageSignals: USAGE_SIGNALS[kind],
		checkedAt: Date.now(),
	});
}

export async function loadAgentAccountStatus(): Promise<{
	providers: AgentAccountProviderStatus[];
}> {
	return {
		providers: await Promise.all([
			providerStatus("claude"),
			providerStatus("codex"),
		]),
	};
}
