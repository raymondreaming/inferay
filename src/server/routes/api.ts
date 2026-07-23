import { exec, execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import {
	mkdir,
	readdir,
	readFile,
	realpath,
	stat,
	writeFile,
} from "node:fs/promises";
import { homedir, hostname, platform, tmpdir } from "node:os";
import {
	basename,
	delimiter,
	dirname,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { promisify } from "node:util";
import type { AgentAccountProviderStatus } from "../../features/agents/agent-account-status.ts";
import type { ChatAgentKind } from "../../features/agents/agents.ts";
import type { Prompt } from "../../features/prompts/types.ts";
import {
	createAgentEnv,
	hasAgentCli,
	resolveAgentBinary,
} from "../../features/terminal/terminal-command.ts";
import {
	shouldSyncClientStorageKey,
	TERMINAL_STATE_STORAGE_KEY,
} from "../../lib/client-storage-keys.ts";
import {
	hasCommand,
	hasObjectId,
	isActive,
	isBuiltIn,
	isString,
	lacksObjectId,
	noop,
} from "../../lib/data.ts";
import { FEATURE_FLAGS } from "../../lib/feature-flags.ts";
import {
	atomicWriteJson,
	badRequest,
	notFound,
	readJson,
	tryRoute,
	writeJson,
} from "../../lib/route-helpers.ts";
import { PROJECT_ROOT, userDataPath } from "../../lib/user-data.ts";
import type { AgentRunContext } from "../agents/events.ts";
import { getAgentAdapter, resolveAgentModel } from "../agents/registry.ts";
import {
	isAllowedLocalPath,
	isWithinDirectory,
	resolveAllowedLocalPath,
} from "../security.ts";
import { ChatService } from "../services/agent-chat.ts";
import { CheckpointService } from "../services/checkpoint.ts";
import { ConfigManager } from "../services/config-manager.ts";
import {
	resolveNativeCoreBinary,
	runNativeCore,
} from "../services/native-core.ts";
import { gitRoutes } from "./git.ts";
import { simulatorRoutes } from "./simulator.ts";
import { readTerminalState, terminalRoutes } from "./terminal.ts";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const configManager = new ConfigManager();

const PROMPTS_FILE = userDataPath("prompts.json");
const REPO_PROMPTS_FILE = resolve(PROJECT_ROOT, "data/prompts.json");
const LEGACY_PROMPTS_FILE = resolve(PROJECT_ROOT, "src/data/prompts.json");

export type PromptServiceResult<T> =
	| { ok: true; value: T }
	| { ok: false; status: number; error: string };

async function loadBundledPrompts(): Promise<Prompt[]> {
	const repoFile = Bun.file(REPO_PROMPTS_FILE);
	if (await repoFile.exists()) {
		return JSON.parse(await repoFile.text()) as Prompt[];
	}

	const legacyFile = Bun.file(LEGACY_PROMPTS_FILE);
	if (!(await legacyFile.exists())) return [];

	return JSON.parse(await legacyFile.text()) as Prompt[];
}

async function loadLocalPrompts(): Promise<Prompt[]> {
	const file = Bun.file(PROMPTS_FILE);
	if (!(await file.exists())) return [];
	return JSON.parse(await file.text()) as Prompt[];
}

export function mergePrompts(bundled: Prompt[], local: Prompt[]): Prompt[] {
	const localById = new Map(local.map((prompt) => [prompt._id, prompt]));
	const localBuiltInByCommand = new Map(
		local.flatMap((prompt) =>
			isBuiltIn(prompt) ? [[prompt.command, prompt] as const] : []
		)
	);
	const bundledBuiltIns = bundled.filter(isBuiltIn);
	const builtInIds = new Set(bundledBuiltIns.map((prompt) => prompt._id));
	const builtInCommands = new Set(
		bundledBuiltIns.map((prompt) => prompt.command)
	);

	const builtIns = bundledBuiltIns.map((prompt) => {
		const localPrompt =
			localById.get(prompt._id) ?? localBuiltInByCommand.get(prompt.command);
		return {
			...prompt,
			isBuiltIn: true,
			executionCount: localPrompt?.executionCount ?? prompt.executionCount ?? 0,
			lastUsed: localPrompt?.lastUsed ?? prompt.lastUsed,
		};
	});
	const customById = new Map<string, Prompt>();
	for (const prompt of bundled) {
		if (
			!prompt.isBuiltIn &&
			!builtInIds.has(prompt._id) &&
			!builtInCommands.has(prompt.command)
		) {
			customById.set(prompt._id, prompt);
		}
	}
	for (const prompt of local) {
		if (
			!prompt.isBuiltIn &&
			!builtInIds.has(prompt._id) &&
			!builtInCommands.has(prompt.command)
		) {
			customById.set(prompt._id, prompt);
		}
	}
	const custom = Array.from(customById.values());

	return [...builtIns, ...custom];
}

async function loadPrompts(): Promise<Prompt[]> {
	const [bundled, local] = await Promise.all([
		loadBundledPrompts(),
		loadLocalPrompts(),
	]);
	return mergePrompts(bundled, local);
}

async function listPromptsByUsage(): Promise<Prompt[]> {
	const prompts = await loadPrompts();
	return prompts.toSorted((a, b) => b.executionCount - a.executionCount);
}

async function savePrompts(prompts: Prompt[]): Promise<void> {
	await atomicWriteJson(PROMPTS_FILE, prompts, 2);
}

let promptsWriteQueue: Promise<unknown> = Promise.resolve();

function withPromptsWrite<T>(fn: () => Promise<T>): Promise<T> {
	const next = promptsWriteQueue.then(fn, fn);
	promptsWriteQueue = next.catch(noop);
	return next;
}

function promptError(
	status: number,
	error: string
): PromptServiceResult<never> {
	return { ok: false, status, error };
}

async function createPrompt(
	body: Partial<Prompt>
): Promise<PromptServiceResult<Prompt>> {
	return withPromptsWrite(async () => {
		const prompts = await loadPrompts();

		const existing = prompts.find(hasCommand.bind(null, body.command));
		if (existing) {
			return promptError(400, `Command /${body.command} already exists`);
		}

		const now = Date.now();
		const prompt: Prompt = {
			_id: `custom-${now}`,
			name: body.name,
			description: body.description || body.name,
			command: body.command,
			promptTemplate: body.promptTemplate,
			category: body.category || "custom",
			tags: body.tags || [],
			isBuiltIn: false,
			executionCount: 0,
			createdAt: now,
			updatedAt: now,
		} as Prompt;

		prompts.push(prompt);
		await savePrompts(prompts);
		return { ok: true, value: prompt };
	});
}

async function updatePrompt(
	id: string,
	body: Partial<Prompt>
): Promise<PromptServiceResult<Prompt>> {
	return withPromptsWrite(async () => {
		const prompts = await loadPrompts();

		const idx = prompts.findIndex(hasObjectId.bind(null, id));
		if (idx === -1) return promptError(404, "Not found");

		const current = prompts[idx]!;
		if (current.isBuiltIn)
			return promptError(400, "Cannot edit built-in prompts");

		if (body.command && body.command !== current.command) {
			const conflict = prompts.find(
				(p) => p.command === body.command && lacksObjectId(id, p)
			);
			if (conflict) {
				return promptError(400, `Command /${body.command} already exists`);
			}
		}

		prompts[idx] = {
			...current,
			name: typeof body.name === "string" ? body.name : current.name,
			description:
				typeof body.description === "string"
					? body.description
					: current.description,
			command:
				typeof body.command === "string" ? body.command : current.command,
			promptTemplate:
				typeof body.promptTemplate === "string"
					? body.promptTemplate
					: current.promptTemplate,
			category:
				typeof body.category === "string" ? body.category : current.category,
			tags: Array.isArray(body.tags)
				? body.tags.filter(isString)
				: current.tags,
			updatedAt: Date.now(),
		};
		await savePrompts(prompts);
		return { ok: true, value: prompts[idx] };
	});
}

async function deletePrompt(
	id: string
): Promise<PromptServiceResult<{ ok: true }>> {
	return withPromptsWrite(async () => {
		const prompts = await loadPrompts();
		const prompt = prompts.find(hasObjectId.bind(null, id));
		if (!prompt) return promptError(404, "Not found");
		if (prompt.isBuiltIn)
			return promptError(400, "Cannot delete built-in prompts");

		await savePrompts(prompts.filter(lacksObjectId.bind(null, id)));
		return { ok: true, value: { ok: true } };
	});
}

async function incrementPromptUsage(
	id: string
): Promise<PromptServiceResult<{ ok: true }>> {
	return withPromptsWrite(async () => {
		const prompts = await loadPrompts();
		const idx = prompts.findIndex(hasObjectId.bind(null, id));
		if (idx === -1) return promptError(404, "Not found");

		const prompt = prompts[idx];
		if (!prompt) return promptError(404, "Not found");

		prompt.executionCount += 1;
		prompt.lastUsed = Date.now();
		await savePrompts(prompts);
		return { ok: true, value: { ok: true } };
	});
}

function resultResponse<T>(result: PromptServiceResult<T>): Response {
	return result.ok
		? Response.json(result.value)
		: Response.json({ error: result.error }, { status: result.status });
}

export function promptRoutes() {
	return {
		"/api/prompts": {
			GET: tryRoute(async () => Response.json(await listPromptsByUsage())),
			POST: tryRoute(async (req) =>
				resultResponse(
					await createPrompt((await req.json()) as Partial<Prompt>)
				)
			),
		},
	};
}

// These need to be handled in the fetch handler since Bun routes don't support path params.
export function handlePromptRequest(
	req: Request
): Response | Promise<Response> | null {
	const url = new URL(req.url);
	const match = url.pathname.match(/^\/api\/prompts\/([^/]+)(\/usage)?$/);
	if (!match) return null;

	const id = match[1]!;
	const isUsage = !!match[2];

	if (isUsage && req.method === "POST") {
		return incrementPromptUsage(id).then(resultResponse);
	}
	if (req.method === "PUT") {
		return req
			.json()
			.then((body) => updatePrompt(id, body as Partial<Prompt>))
			.then(resultResponse);
	}
	if (req.method === "DELETE") {
		return deletePrompt(id).then(resultResponse);
	}
	return null;
}

interface AppInfo {
	name: string;
	version: string;
	hash?: string;
	channel: string;
	identifier?: string;
	production: boolean;
	update: AppUpdateInfo;
}

interface AppUpdateInfo {
	available: boolean;
	currentVersion: string;
	latestVersion: string | null;
	url: string | null;
	checkedAt: number;
	error?: string;
}

interface TerminalPaneSnapshot {
	id?: unknown;
	title?: unknown;
	agentKind?: unknown;
	cwd?: unknown;
	pendingCwd?: unknown;
}

interface LocalSessionInfo {
	paneId: string;
	title: string;
	agentKind: "claude" | "codex";
	cwd: string | null;
	messageCount: number;
	lastMessage: string | null;
	lastRole: string | null;
	updatedAt: number;
	inCurrentWorkspace: boolean;
}

interface ParsedDiff {
	hunks: Array<{
		oldStart: number;
		oldCount: number;
		newStart: number;
		newCount: number;
		lines: Array<{
			type: "unchanged" | "added" | "removed";
			content: string;
			oldLineNum?: number;
			newLineNum?: number;
		}>;
	}>;
	oldLines: Array<{
		type: "unchanged" | "added" | "removed";
		content: string;
		oldLineNum?: number;
		newLineNum?: number;
	}>;
	newLines: Array<{
		type: "unchanged" | "added" | "removed";
		content: string;
		oldLineNum?: number;
		newLineNum?: number;
	}>;
	stats: { added: number; removed: number; unchanged: number };
	computedAt: number;
}

interface NativeDiffResponse {
	op: "diff";
	diff: ParsedDiff;
}

interface UpdateLaunchResult {
	ok: boolean;
	logPath?: string;
	error?: string;
}

type StoredValue = string | null;
type ClientStorageSnapshot = Record<string, string>;

interface AgentAccountStatusInput {
	kind: ChatAgentKind;
	label: string;
	installed: boolean;
	binaryPath: string;
	version: string | null;
	authConfigPaths: string[];
	usageSignals: string[];
	checkedAt: number;
}

interface RunAgentOnceOptions {
	agentKind: ChatAgentKind;
	prompt: string;
	cwd: string;
	model?: string;
	reasoningLevel?: string;
	timeoutMs?: number;
}

interface AutomationStore {
	flows: unknown[];
}

interface AutomationRunRequest {
	prompt?: string;
	cwd?: string;
	timeoutMs?: number;
}

type AutomationRunResult =
	| { ok: true; result: string | null }
	| { ok: false; status: number; error: string };

const VERSION_JSON_CANDIDATES = [
	resolve(PROJECT_ROOT, "version.json"),
	resolve(dirname(PROJECT_ROOT), "version.json"),
];
const PACKAGE_JSON = resolve(PROJECT_ROOT, "packages/inferay/package.json");
const DEFAULT_RELEASE_REPO = "raymondreaming/inferay";
const RELEASE_CHECK_TIMEOUT_MS = 1500;
const RELEASE_CHECK_CACHE_TTL_MS = 15 * 60 * 1000;
const CHAT_TRANSCRIPTS_DIR = userDataPath("chat-transcripts");
const AUTOMATIONS_FILE = userDataPath("automations.json");
const CLIENT_STORAGE_PATH = userDataPath("client-storage.json");
const IMAGE_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".bmp",
	".ico",
]);
const TMP_DIR = resolve(PROJECT_ROOT, "data/.tmp");
const MAX_TEMP_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_SERVED_FILE_BYTES = 20 * 1024 * 1024;
const MAX_NATIVE_DIFF_LINES = 2000;
const BACKGROUND_DIR = userDataPath("backgrounds");
const CUSTOM_BACKGROUND_FILE = resolve(BACKGROUND_DIR, "custom-background");
const CUSTOM_BACKGROUND_META_FILE = resolve(
	BACKGROUND_DIR,
	"custom-background.json"
);
const BACKGROUND_CONTENT_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
]);

let releaseCheckCache: {
	key: string;
	expiresAt: number;
	info: AppUpdateInfo;
} | null = null;

async function readAppInfoJson(
	path: string
): Promise<Record<string, unknown> | null> {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function releaseApiUrl(channel: string): string {
	if (process.env.INFERAY_RELEASE_URL) return process.env.INFERAY_RELEASE_URL;
	const repo = process.env.INFERAY_RELEASE_REPO || DEFAULT_RELEASE_REPO;
	if (channel === "stable") {
		return `https://api.github.com/repos/${repo}/releases/latest`;
	}
	return `https://api.github.com/repos/${repo}/releases/tags/${channel}`;
}

function parseVersion(value: string): [number, number, number] | null {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewerVersion(candidate: string, current: string): boolean {
	const next = parseVersion(candidate);
	const base = parseVersion(current);
	if (!next || !base) return false;
	for (let index = 0; index < next.length; index += 1) {
		if (next[index]! > base[index]!) return true;
		if (next[index]! < base[index]!) return false;
	}
	return false;
}

async function loadUpdateInfo(
	currentVersion: string,
	channel: string
): Promise<AppUpdateInfo> {
	const cacheKey = `${currentVersion}:${channel}`;
	if (
		releaseCheckCache &&
		releaseCheckCache.key === cacheKey &&
		releaseCheckCache.expiresAt > Date.now()
	) {
		return releaseCheckCache.info;
	}
	const checkedAt = Date.now();
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		RELEASE_CHECK_TIMEOUT_MS
	);
	try {
		const response = await fetch(releaseApiUrl(channel), {
			headers: {
				accept: "application/vnd.github+json",
				"user-agent": "inferay-app",
			},
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`release check failed (${response.status})`);
		}
		const release = (await response.json()) as Record<string, unknown>;
		const latestVersion =
			typeof release.tag_name === "string"
				? release.tag_name.replace(/^v/, "")
				: null;
		const url = typeof release.html_url === "string" ? release.html_url : null;
		const info = {
			available: latestVersion
				? isNewerVersion(latestVersion, currentVersion)
				: false,
			currentVersion,
			latestVersion,
			url,
			checkedAt,
		};
		releaseCheckCache = {
			key: cacheKey,
			expiresAt: Date.now() + RELEASE_CHECK_CACHE_TTL_MS,
			info,
		};
		return info;
	} catch (error) {
		const info = {
			available: false,
			currentVersion,
			latestVersion: null,
			url: null,
			checkedAt,
			error: error instanceof Error ? error.message : "release check failed",
		};
		releaseCheckCache = {
			key: cacheKey,
			expiresAt: Date.now() + Math.min(RELEASE_CHECK_CACHE_TTL_MS, 60_000),
			info,
		};
		return info;
	} finally {
		clearTimeout(timeout);
	}
}

async function loadAppInfo(): Promise<AppInfo> {
	let versionInfo: Record<string, unknown> | null = null;
	for (const path of VERSION_JSON_CANDIDATES) {
		versionInfo = await readAppInfoJson(path);
		if (versionInfo) break;
	}

	if (versionInfo) {
		const version = String(versionInfo.version || "dev");
		const channel = String(versionInfo.channel || "stable");
		return {
			name: String(versionInfo.name || "inferay"),
			version,
			hash: typeof versionInfo.hash === "string" ? versionInfo.hash : undefined,
			channel,
			identifier:
				typeof versionInfo.identifier === "string"
					? versionInfo.identifier
					: undefined,
			production: versionInfo.identifier === "com.inferay.app",
			update: await loadUpdateInfo(version, channel),
		};
	}

	const pkg = await readAppInfoJson(PACKAGE_JSON);
	const version = typeof pkg?.version === "string" ? pkg.version : "dev";
	const channel = "stable";
	return {
		name: "inferay",
		version,
		channel,
		production: false,
		update: await loadUpdateInfo(version, channel),
	};
}

async function listLocalSessions(): Promise<LocalSessionInfo[]> {
	const [paneMetadata, transcriptFiles, eventPaneIds] = await Promise.all([
		readPaneMetadata(),
		readdir(CHAT_TRANSCRIPTS_DIR).catch(() => []),
		ChatService.listPersistedEventPaneIds(),
	]);
	const paneIds = new Set([
		...transcriptFiles.flatMap((file) =>
			file.endsWith(".json") ? [file.slice(0, -".json".length)] : []
		),
		...eventPaneIds,
	]);
	const sessions: LocalSessionInfo[] = [];
	for (const paneId of paneIds) {
		const transcript = await ChatService.readRestoredMessages(paneId);
		if (!transcript.length) continue;
		const fileStat = await stat(
			join(CHAT_TRANSCRIPTS_DIR, `${paneId}.json`)
		).catch(() => null);
		const pane = paneMetadata.get(paneId);
		const cwd = pane?.cwd ?? inferCwdFromMessages(transcript);
		const lastMessage = transcript.at(-1) ?? null;
		sessions.push({
			paneId,
			title: pane?.title ?? (cwd ? basename(cwd) : "Archived session"),
			agentKind: pane?.agentKind ?? "codex",
			cwd,
			messageCount: transcript.length,
			lastMessage: lastMessage?.content?.trim() || null,
			lastRole: lastMessage?.role ?? null,
			updatedAt: fileStat?.mtimeMs ?? 0,
			inCurrentWorkspace: paneMetadata.has(paneId),
		});
	}
	return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function readPaneMetadata(): Promise<Map<string, LocalSessionInfo>> {
	const state = await readTerminalState<any | null>(null);
	const metadata = new Map<string, LocalSessionInfo>();
	for (const group of state?.groups ?? []) {
		for (const pane of group.panes ?? []) {
			const value = pane as TerminalPaneSnapshot;
			if (typeof value.id !== "string") continue;
			const cwd = typeof value.cwd === "string" ? value.cwd : null;
			metadata.set(value.id, {
				paneId: value.id,
				title:
					typeof value.title === "string"
						? value.title
						: cwd
							? basename(cwd)
							: "Archived session",
				agentKind: value.agentKind === "claude" ? "claude" : "codex",
				cwd,
				messageCount: 0,
				lastMessage: null,
				lastRole: null,
				updatedAt: 0,
				inCurrentWorkspace: true,
			});
		}
	}
	return metadata;
}

function inferCwdFromMessages(
	messages: Array<{ content: string; role: string }>
): string | null {
	for (const message of messages) {
		if (message.role !== "tool") continue;
		try {
			const parsed = JSON.parse(message.content);
			if (typeof parsed?.cwd === "string") return parsed.cwd;
		} catch {}
	}
	return null;
}

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

const AGENT_LABELS: Record<ChatAgentKind, string> = {
	claude: "Claude",
	codex: "Codex",
};

function buildAgentAccountStatus(
	input: AgentAccountStatusInput
): AgentAccountProviderStatus {
	if (!input.installed) {
		return {
			...input,
			authConfigPaths: [],
			health: "missing-cli",
			summary: `${input.label} CLI was not found on this machine.`,
		};
	}

	if (input.authConfigPaths.length === 0) {
		return {
			...input,
			health: "needs-login",
			summary: `${input.label} CLI is installed, but Inferay did not find local auth config.`,
		};
	}

	return {
		...input,
		health: "ready",
		summary: `${input.label} CLI and local auth config detected.`,
	};
}

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
		label: AGENT_LABELS[kind],
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

async function loadAgentAccountStatus(): Promise<{
	providers: AgentAccountProviderStatus[];
}> {
	return {
		providers: await Promise.all([
			providerStatus("claude"),
			providerStatus("codex"),
		]),
	};
}

function extractChatResult(event: unknown): string {
	const value = event as any;
	if (!value?.type) return "";
	if (value.type === "result" && typeof value.result === "string") {
		return value.result;
	}
	if (value.type === "content_block_delta") {
		const delta = value.delta;
		if (delta?.type === "text_delta" && typeof delta.text === "string") {
			return delta.text;
		}
	}
	if (value.type === "content_block_start") {
		const block = value.content_block;
		if (block?.type === "text" && typeof block.text === "string") {
			return block.text;
		}
	}
	return "";
}

async function runAgentOnce({
	agentKind,
	prompt,
	cwd,
	model,
	reasoningLevel,
	timeoutMs = 30_000,
}: RunAgentOnceOptions): Promise<string | null> {
	const adapter = getAgentAdapter(agentKind);
	let sessionId: string | null = null;
	let resultText = "";
	let streamedText = "";

	const ctx: AgentRunContext = {
		paneId: `one-off-${agentKind}-${Date.now()}`,
		cwd,
		model: resolveAgentModel(agentKind, model),
		reasoningLevel,
		getSessionId: () => sessionId,
		isCancelled: () => false,
		updateSessionId: (nextSessionId) => {
			sessionId = nextSessionId;
		},
		emitChatEvent: (event) => {
			const text = extractChatResult(event);
			if (!text) return;
			const value = event as any;
			if (value?.type === "result") resultText = text;
			else streamedText += text;
		},
		emitAgentEvent: (event) => {
			if (event.type === "result") resultText = event.text;
			if (event.type === "text-delta") streamedText += event.text;
		},
		emitStatus: noop,
		emitActivity: noop,
		emitSystemMessage: noop,
	};

	const state = adapter.createState(ctx);
	const handle = adapter.createHandle(prompt, ctx, state);
	let timeout: ReturnType<typeof setTimeout> | null = null;

	try {
		const output = await Promise.race([
			handle.run(),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => {
					handle.kill();
					reject(new Error(`${adapter.displayName} one-off call timed out`));
				}, timeoutMs);
			}),
		]);
		const lastAssistantMessage =
			output && typeof output === "object"
				? output.lastAssistantMessage
				: undefined;
		const text = (lastAssistantMessage || resultText || streamedText).trim();
		return text || null;
	} catch {
		return null;
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

function fallbackTitle(userMessage: string): string {
	const line = userMessage.trim().split("\n")[0] ?? "";
	return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

async function generateTitle(userMessage: string): Promise<string> {
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

async function generateCommitMessage(cwd: string): Promise<string | null> {
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

function appInfoRoutes() {
	return {
		"/api/app-info": {
			GET: async () => Response.json(await loadAppInfo()),
		},
	};
}

function agentAccountRoutes() {
	return {
		"/api/agents/account-status": {
			GET: async () => Response.json(await loadAgentAccountStatus()),
		},
	};
}

function titleRoutes() {
	return {
		"/api/generate-title": {
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as { message?: string };
				if (typeof body.message !== "string" || !body.message.trim()) {
					return badRequest("Missing message");
				}
				const title = await generateTitle(body.message);
				return Response.json({ title });
			}),
		},
		"/api/git/generate-commit-message": {
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as { cwd?: string };
				if (typeof body.cwd !== "string" || !body.cwd.trim()) {
					return badRequest("Missing cwd");
				}
				const cwd = resolveAllowedLocalPath(body.cwd);
				if (!cwd) {
					return Response.json(
						{ error: "Path is outside allowed local roots" },
						{ status: 403 }
					);
				}
				const message = await generateCommitMessage(cwd);
				if (!message) {
					return Response.json(
						{
							error: "No staged changes or Claude is unavailable",
						},
						{ status: 400 }
					);
				}
				return Response.json({ message });
			}),
		},
	};
}

const ACCOUNTS_CACHE_TTL_MS = 30_000;
const REPOS_CACHE_TTL_MS = 120_000;
const TOOL_PATHS = [
	"/opt/homebrew/bin",
	"/usr/local/bin",
	"/usr/bin",
	"/bin",
	"/usr/sbin",
	"/sbin",
];
const GH_CANDIDATES = [
	...TOOL_PATHS.map((path) => `${path}/gh`),
	"/opt/homebrew/bin/gh",
	"/usr/local/bin/gh",
];

let accountsCache: { value: ForgeAccount[]; cachedAt: number } | null = null;
let reposCache: {
	limit: number;
	value: GithubRepo[];
	cachedAt: number;
} | null = null;

interface ForgeAccount {
	provider: "github";
	host: string;
	login: string;
	name: string | null;
	avatarUrl: string | null;
	email: string | null;
	active: boolean;
}

interface GhAuthEntry {
	state?: string;
	active?: boolean;
	host?: string;
	login?: string;
}

interface GhAuthStatus {
	hosts?: Record<string, GhAuthEntry[]>;
}

interface GithubUser {
	name?: string | null;
	avatar_url?: string | null;
	email?: string | null;
}

function toolEnv() {
	const existingPath = process.env.PATH ?? "";
	return {
		...process.env,
		PATH: [...TOOL_PATHS, existingPath].filter(Boolean).join(":"),
	};
}

function resolveGhBinary() {
	return GH_CANDIDATES.find((candidate) => existsSync(candidate)) ?? "gh";
}

async function runGh(args: string[], timeout = 15000) {
	return execFileAsync(resolveGhBinary(), args, {
		encoding: "utf-8",
		timeout,
		maxBuffer: 1024 * 1024,
		env: toolEnv(),
	});
}

async function runGit(args: string[], cwd?: string, timeout = 120000) {
	return execFileAsync("git", args, {
		cwd,
		encoding: "utf-8",
		timeout,
		maxBuffer: 1024 * 1024,
		env: toolEnv(),
	});
}

function isLoggedOut(stderr: string) {
	const text = stderr.toLowerCase();
	return (
		text.includes("not logged in") ||
		text.includes("no authentication") ||
		text.includes("gh auth login")
	);
}

async function fetchGithubProfile(
	host: string,
	login: string
): Promise<Pick<ForgeAccount, "name" | "avatarUrl" | "email">> {
	try {
		const { stdout } = await runGh([
			"api",
			"--hostname",
			host,
			"-H",
			"Accept: application/vnd.github+json",
			`/users/${login}`,
		]);
		const user = JSON.parse(stdout) as GithubUser;
		return {
			name: user.name?.trim() || null,
			avatarUrl: user.avatar_url ?? null,
			email: user.email?.trim() || null,
		};
	} catch {
		return { name: null, avatarUrl: null, email: null };
	}
}

async function listGithubAccounts(): Promise<ForgeAccount[]> {
	if (
		accountsCache &&
		Date.now() - accountsCache.cachedAt < ACCOUNTS_CACHE_TTL_MS
	) {
		return accountsCache.value;
	}

	try {
		const { stdout } = await runGh(["auth", "status", "--json", "hosts"]);
		const parsed = JSON.parse(stdout) as GhAuthStatus;
		const entries = Object.entries(parsed.hosts ?? {}).flatMap(
			([host, accounts]) =>
				accounts.flatMap((account) => {
					if (account.state !== "success") return [];
					const login = account.login?.trim() ?? "";
					if (!login) return [];
					return [
						{
							host,
							login,
							active: Boolean(account.active),
						},
					];
				})
		);

		const accounts = await Promise.all(
			entries.map(async (entry) => {
				const profile = await fetchGithubProfile(entry.host, entry.login);
				return {
					provider: "github" as const,
					host: entry.host,
					login: entry.login,
					active: entry.active,
					...profile,
				};
			})
		);

		const sorted = accounts.sort((a, b) => {
			if (a.host !== b.host) return a.host.localeCompare(b.host);
			if (a.active !== b.active) return a.active ? -1 : 1;
			return a.login.localeCompare(b.login);
		});
		accountsCache = { value: sorted, cachedAt: Date.now() };
		return sorted;
	} catch (error) {
		const stderr =
			typeof error === "object" && error && "stderr" in error
				? String((error as { stderr?: unknown }).stderr ?? "")
				: "";
		if (isLoggedOut(stderr)) {
			accountsCache = { value: [], cachedAt: Date.now() };
			return [];
		}
		throw error;
	}
}

function quoteAppleScript(value: string) {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function openGithubLogin() {
	accountsCache = null;
	reposCache = null;
	if (platform() === "darwin") {
		const gh = resolveGhBinary();
		const script = [
			'tell application "Terminal"',
			"activate",
			`do script "${quoteAppleScript(`${gh} auth login`)} "`,
			"end tell",
		].join("\n");
		await execFileAsync("osascript", ["-e", script], { timeout: 10000 });
		return true;
	}

	const command =
		platform() === "win32"
			? ["cmd.exe", "/c", "start", "cmd.exe", "/k", "gh auth login"]
			: ["x-terminal-emulator", "-e", "gh auth login"];
	const proc = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
	return (await proc.exited) === 0;
}

interface GithubRepo {
	name: string;
	full_name: string;
	description: string | null;
	html_url: string;
	language: string | null;
	stargazers_count: number;
	updated_at: string;
	private: boolean;
}

async function listGithubRepos(limit = 30): Promise<GithubRepo[]> {
	if (
		reposCache &&
		reposCache.limit >= limit &&
		Date.now() - reposCache.cachedAt < REPOS_CACHE_TTL_MS
	) {
		return reposCache.value.slice(0, limit);
	}

	try {
		const accounts = await listGithubAccounts();
		const active = accounts.find(isActive) ?? accounts[0];
		const ownerArg = active?.login ? [active.login] : [];
		const { stdout } = await runGh(
			[
				"repo",
				"list",
				...ownerArg,
				"--json",
				"name,description,url,primaryLanguage,stargazerCount,updatedAt,isPrivate,nameWithOwner",
				"--limit",
				String(limit),
			],
			20000
		);
		const raw = JSON.parse(stdout) as Array<{
			name: string;
			nameWithOwner: string;
			description: string | null;
			url: string;
			primaryLanguage?: { name?: string | null } | null;
			stargazerCount: number;
			updatedAt: string;
			isPrivate: boolean;
		}>;
		const repos = raw.map((r) => ({
			name: r.name,
			full_name: r.nameWithOwner,
			description: r.description,
			html_url: r.url,
			language: r.primaryLanguage?.name ?? null,
			stargazers_count: r.stargazerCount,
			updated_at: r.updatedAt,
			private: r.isPrivate,
		}));
		reposCache = { limit, value: repos, cachedAt: Date.now() };
		return repos;
	} catch {
		return [];
	}
}

function expandHome(path: string) {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
	return resolve(path);
}

function displayPath(path: string) {
	const home = homedir();
	return path.startsWith(`${home}/`)
		? `~/${path.slice(home.length + 1)}`
		: path;
}

function inferRepoName(url: string) {
	const cleaned = url
		.trim()
		.replace(/\/+$/, "")
		.replace(/\.git$/, "");
	return basename(cleaned.replace(/:/g, "/"));
}

function isGithubCloneUrl(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" && url.protocol !== "ssh:") return false;
		return url.hostname === "github.com" || url.hostname.endsWith(".ghe.com");
	} catch {
		return /^git@(?:github\.com|[\w.-]+\.ghe\.com):[\w.-]+\/[\w.-]+(?:\.git)?$/i.test(
			value
		);
	}
}

async function addSearchFolder(folder: string) {
	const config = await configManager.load();
	const current = Array.isArray(config.search_folders)
		? config.search_folders.filter(isString)
		: [];
	const shown = displayPath(folder);
	if (current.includes(shown) || current.includes(folder)) return;
	await configManager.update({ search_folders: [...current, shown] });
}

async function cloneRepository(gitUrl: string, cloneDirectory: string) {
	const url = gitUrl.trim();
	const parent = resolveAllowedLocalPath(expandHome(cloneDirectory.trim()));
	if (!url) throw new Error("Git URL is required");
	if (!cloneDirectory.trim()) throw new Error("Clone location is required");
	if (!isGithubCloneUrl(url)) {
		throw new Error("Only GitHub clone URLs are supported");
	}
	if (!parent) {
		throw new Error("Clone location is outside allowed local roots");
	}

	await mkdir(parent, { recursive: true });
	const repoName = inferRepoName(url);
	if (!repoName) throw new Error("Unable to determine repository name");
	const target = resolve(parent, repoName);
	if (await Bun.file(target).exists()) {
		throw new Error(`Target already exists: ${target}`);
	}

	await runGit(["clone", "--", url, target], parent);
	await addSearchFolder(parent);
	reposCache = null;
	return { path: target, displayPath: displayPath(target) };
}

function forgeRoutes() {
	return {
		"/api/forge/accounts": {
			GET: tryRoute(async (req) => {
				const url = new URL(req.url);
				if (url.searchParams.has("refresh")) {
					accountsCache = null;
				}
				const accounts = await listGithubAccounts();
				return Response.json({ accounts });
			}),
		},
		"/api/forge/repos": {
			GET: tryRoute(async (req) => {
				const url = new URL(req.url);
				const limit = Math.min(
					Number(url.searchParams.get("limit") ?? 30),
					100
				);
				const repos = await listGithubRepos(limit);
				return Response.json({ repos });
			}),
		},
		"/api/forge/clone": {
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as {
					gitUrl?: string;
					cloneDirectory?: string;
				};
				if (typeof body.gitUrl !== "string" || !body.gitUrl.trim()) {
					return badRequest("Missing Git URL");
				}
				if (
					typeof body.cloneDirectory !== "string" ||
					!body.cloneDirectory.trim()
				) {
					return badRequest("Missing clone location");
				}
				const result = await cloneRepository(body.gitUrl, body.cloneDirectory);
				return Response.json({ ok: true, ...result });
			}),
		},
		"/api/forge/connect": {
			POST: tryRoute(async (req) => {
				const body = (await req.json().catch(() => ({}))) as {
					provider?: string;
				};
				if (body.provider && body.provider !== "github") {
					return badRequest("Only GitHub connect is supported right now");
				}
				const ok = await openGithubLogin();
				return Response.json({ ok });
			}),
		},
	};
}

function configRoutes() {
	return {
		"/api/config": {
			GET: async () => {
				const config = await configManager.load();
				return Response.json(config);
			},
			PUT: async (req: Request) => {
				const updates = await req.json();
				const config = await configManager.update(updates);
				return Response.json(config);
			},
		},
		"/api/config/search-folders": {
			GET: async () => {
				const config = await configManager.load();
				const folders = Array.isArray(config.search_folders)
					? config.search_folders
					: [];
				return Response.json({ folders });
			},
			PUT: async (req: Request) => {
				const { folders } = (await req.json()) as { folders: string[] };
				if (!Array.isArray(folders)) {
					return new Response("folders must be an array", { status: 400 });
				}
				const config = await configManager.update({
					search_folders: folders,
				});
				return Response.json({
					folders: config.search_folders,
				});
			},
		},
		"/api/config/background-image": {
			GET: tryRoute(async () => {
				const file = Bun.file(CUSTOM_BACKGROUND_FILE);
				if (!(await file.exists())) {
					return new Response("Not found", { status: 404 });
				}
				const meta = await readJson<{ contentType?: string }>(
					CUSTOM_BACKGROUND_META_FILE,
					{}
				);
				return new Response(file, {
					headers: {
						"Content-Type": BACKGROUND_CONTENT_TYPES.has(meta.contentType ?? "")
							? meta.contentType!
							: "image/jpeg",
						"Cache-Control": "no-store",
					},
				});
			}),
			POST: tryRoute(async (req) => {
				const formData = await req.formData();
				const file = formData.get("file");
				if (!(file instanceof File)) {
					return badRequest("No background image provided");
				}
				if (file.size > MAX_TEMP_UPLOAD_BYTES) {
					return new Response("Image must be 20 MB or smaller", {
						status: 413,
					});
				}
				if (!BACKGROUND_CONTENT_TYPES.has(file.type)) {
					return badRequest("Use a PNG, JPEG, WebP, or GIF image");
				}
				await mkdir(BACKGROUND_DIR, { recursive: true });
				await Bun.write(CUSTOM_BACKGROUND_FILE, file);
				const revision = Date.now();
				await atomicWriteJson(CUSTOM_BACKGROUND_META_FILE, {
					contentType: file.type,
					name: file.name,
					revision,
				});
				return Response.json({ ok: true, revision });
			}),
		},
		"/api/config/pick-folder": {
			POST: async () => {
				try {
					let folderPath: string | null = null;
					if (platform() === "darwin") {
						const { stdout } = await execAsync(
							`osascript -e 'POSIX path of (choose folder with prompt "Select a folder to add")'`,
							{ encoding: "utf-8", timeout: 120000 }
						);
						const trimmed = stdout.trim();
						if (trimmed) folderPath = trimmed;
					} else if (platform() === "win32") {
						const { stdout } = await execAsync(
							`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; if($f.ShowDialog() -eq 'OK'){$f.SelectedPath}"`,
							{ encoding: "utf-8", timeout: 120000 }
						);
						const trimmed = stdout.trim();
						if (trimmed) folderPath = trimmed;
					}
					if (!folderPath) {
						return Response.json({ folder: null });
					}
					const home = homedir();
					const displayPath = folderPath.startsWith(`${home}/`)
						? `~/${folderPath.slice(home.length + 1)}`
						: folderPath;
					const cleaned = displayPath.replace(/\/+$/, "");
					return Response.json({ folder: cleaned });
				} catch {
					return Response.json({ folder: null });
				}
			},
		},
		"/api/machine-id": {
			GET: async () => {
				const config = await configManager.load();
				const machineId =
					(config as any)?.machine_id ||
					process.env.MACHINE_ID ||
					hostname() ||
					"unknown";
				return Response.json({ machineId });
			},
		},
	};
}

async function computeNativeDiff(
	before: string,
	after: string
): Promise<ParsedDiff | null> {
	if (
		before.split("\n", MAX_NATIVE_DIFF_LINES + 1).length >
			MAX_NATIVE_DIFF_LINES ||
		after.split("\n", MAX_NATIVE_DIFF_LINES + 1).length > MAX_NATIVE_DIFF_LINES
	) {
		return null;
	}
	const result = await runNativeCore<
		{ op: "diff"; before: string; after: string },
		NativeDiffResponse
	>({
		op: "diff",
		before,
		after,
	});

	if (!result?.diff) return null;
	result.diff.computedAt = Date.now();
	return result.diff;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		if (!value || seen.has(value)) continue;
		seen.add(value);
		result.push(value);
	}
	return result;
}

function nvmBinDirs(home: string | undefined): string[] {
	if (!home) return [];
	const versionsDir = join(home, ".nvm", "versions", "node");
	try {
		return readdirSync(versionsDir)
			.sort()
			.reverse()
			.map((version) => join(versionsDir, version, "bin"));
	} catch {
		return [];
	}
}

export function createInferayUpdatePath(
	env: Record<string, string | undefined> = process.env
): string {
	const home = env.HOME || env.USERPROFILE || env.HOMEPATH;
	return uniqueStrings([
		...(env.PATH ?? "").split(delimiter),
		env.NVM_BIN,
		home ? join(home, ".bun", "bin") : null,
		home ? join(home, ".local", "bin") : null,
		home ? join(home, ".npm-global", "bin") : null,
		...nvmBinDirs(home),
		"/opt/homebrew/bin",
		"/opt/homebrew/sbin",
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
		"/usr/sbin",
		"/sbin",
	]).join(delimiter);
}

function createUpdateEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value != null) env[key] = value;
	}
	env.PATH = createInferayUpdatePath(process.env);
	return env;
}

export function createInferayUpdateCommand(): string {
	return [
		"if command -v npx >/dev/null 2>&1; then",
		"npx --yes inferay update && exit 0;",
		"fi;",
		"if command -v bunx >/dev/null 2>&1; then",
		"bunx inferay update && exit 0;",
		"fi;",
		"echo 'npx or bunx is required to update Inferay' >&2;",
		"exit 127;",
	].join(" ");
}

function runInferayUpdate(): UpdateLaunchResult {
	const env = createUpdateEnv();
	const probe = Bun.spawnSync(
		[
			"/bin/zsh",
			"-lc",
			"command -v npx >/dev/null 2>&1 || command -v bunx >/dev/null 2>&1",
		],
		{ env }
	);
	if (probe.exitCode !== 0) {
		return {
			ok: false,
			error: "npx or bunx is required to update Inferay",
		};
	}

	const logPath = join(tmpdir(), `inferay-update-${Date.now()}.log`);
	const updateCommand = createInferayUpdateCommand();
	const command = [
		"nohup",
		"/bin/zsh",
		"-lc",
		shellQuote(updateCommand),
		`>${shellQuote(logPath)}`,
		"2>&1",
		"</dev/null",
		"&",
	].join(" ");
	try {
		Bun.spawn(["/bin/zsh", "-lc", command], {
			env,
			stdout: "ignore",
			stderr: "ignore",
			stdin: "ignore",
		});
		return { ok: true, logPath };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : "failed to start update",
		};
	}
}

async function openNativePath(path: string, reveal: boolean): Promise<boolean> {
	const os = platform();
	const command =
		os === "darwin"
			? reveal
				? ["open", "-R", path]
				: ["open", path]
			: os === "win32"
				? reveal
					? ["explorer.exe", `/select,${path}`]
					: ["explorer.exe", path]
				: ["xdg-open", reveal ? path.replace(/\/[^/]*$/, "") || path : path];
	const proc = Bun.spawn(command, {
		stdout: "ignore",
		stderr: "ignore",
	});
	const exitCode = await proc.exited;
	return exitCode === 0;
}

function nativeRoutes() {
	return {
		"/api/native/diff": {
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as {
					before?: string;
					after?: string;
				};
				if (typeof body.before !== "string" || typeof body.after !== "string") {
					return badRequest("Missing before/after diff payload");
				}

				const diff = await computeNativeDiff(body.before, body.after);
				if (!diff) {
					return Response.json(
						{
							ok: false,
							error: "Native diff unavailable",
							available: Boolean(resolveNativeCoreBinary()),
						},
						{ status: 503 }
					);
				}

				return Response.json({ ok: true, diff });
			}),
		},
		"/api/native/open-path": {
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as {
					path?: string;
					reveal?: boolean;
				};
				if (typeof body.path !== "string" || !body.path.trim()) {
					return badRequest("Missing path");
				}
				const resolvedPath = resolveAllowedLocalPath(body.path);
				if (!resolvedPath) {
					return Response.json({ error: "Access denied" }, { status: 403 });
				}
				const ok = await openNativePath(resolvedPath, Boolean(body.reveal));
				return Response.json({ ok });
			}),
		},
		"/api/native/update": {
			POST: tryRoute(async () => {
				const result = runInferayUpdate();
				if (!result.ok) {
					return Response.json(result, { status: 503 });
				}
				setTimeout(() => process.exit(0), 500);
				return Response.json({
					...result,
					message: "Updating Inferay. The app will close and relaunch.",
				});
			}),
		},
	};
}

function isAllowedInferayTempPath(pathname: string): boolean {
	if (isWithinDirectory(pathname, TMP_DIR)) return true;
	const marker = `${sep}Contents${sep}Resources${sep}app${sep}data${sep}.tmp`;
	return pathname.includes(marker);
}

async function resolveServeableImagePath(
	pathname: string
): Promise<string | null> {
	const resolved = resolve(pathname);
	try {
		const real = await realpath(resolved);
		if (
			isWithinDirectory(real, PROJECT_ROOT) ||
			isAllowedInferayTempPath(real)
		) {
			return real;
		}
		return null;
	} catch {
		return null;
	}
}

async function getDefaultFileCwd(): Promise<string> {
	const cwds = await getActiveFileCwds();
	return cwds[0] ?? PROJECT_ROOT;
}

async function getActiveFileCwds(): Promise<string[]> {
	const state = await readTerminalState<unknown | null>(null);
	if (typeof state !== "object" || state === null) return [PROJECT_ROOT];
	const groups = (state as { groups?: unknown }).groups;
	if (!Array.isArray(groups)) return [PROJECT_ROOT];
	const selectedGroupId = (state as { selectedGroupId?: unknown })
		.selectedGroupId;
	const selectedGroup =
		(typeof selectedGroupId === "string" &&
			groups.find((group) => {
				return (
					typeof group === "object" &&
					group !== null &&
					(group as { id?: unknown }).id === selectedGroupId
				);
			})) ||
		groups[0];
	if (typeof selectedGroup !== "object" || selectedGroup === null) {
		return [PROJECT_ROOT];
	}
	const panes = (selectedGroup as { panes?: unknown }).panes;
	if (!Array.isArray(panes)) return [PROJECT_ROOT];
	const selectedPaneId = (selectedGroup as { selectedPaneId?: unknown })
		.selectedPaneId;
	const orderedPanes =
		typeof selectedPaneId === "string"
			? [
					...panes.filter(
						(pane) =>
							typeof pane === "object" &&
							pane !== null &&
							(pane as { id?: unknown }).id === selectedPaneId
					),
					...panes.filter(
						(pane) =>
							!(
								typeof pane === "object" &&
								pane !== null &&
								(pane as { id?: unknown }).id === selectedPaneId
							)
					),
				]
			: panes;
	const cwds: string[] = [];
	const seen = new Set<string>();
	for (const pane of orderedPanes) {
		if (typeof pane !== "object" || pane === null) continue;
		const cwd = (pane as { cwd?: unknown }).cwd;
		if (typeof cwd !== "string" || !cwd) continue;
		const resolved = resolve(cwd);
		if (seen.has(resolved) || !isAllowedLocalPath(resolved)) continue;
		seen.add(resolved);
		cwds.push(resolved);
	}
	if (cwds.length > 0) return cwds;
	return [PROJECT_ROOT];
}

type FileSearchRouteResult = {
	name: string;
	path: string;
	isDir: boolean;
	cwd: string;
};

const FILE_SEARCH_SKIP_DIRS = new Set(["node_modules", "build", "dist"]);

async function searchFilesInCwd(
	resolvedCwd: string,
	query: string,
	limit: number
): Promise<FileSearchRouteResult[]> {
	const results: FileSearchRouteResult[] = [];
	const seen = new Set<string>();

	function addFile(filePath: string, name = basename(filePath)) {
		if (results.length >= limit || !filePath) return;
		const lower = filePath.toLowerCase();
		if (query && !lower.includes(query)) return;
		if (seen.has(filePath)) return;
		seen.add(filePath);
		results.push({
			name,
			path: filePath,
			isDir: false,
			cwd: resolvedCwd,
		});
	}

	try {
		const { stdout } = await execFileAsync("git", [
			"-C",
			resolvedCwd,
			"ls-files",
			"-co",
			"--exclude-standard",
		]);
		for (const filePath of stdout.split("\n")) addFile(filePath);
		if (results.length > 0 || query) return results;
	} catch {}

	async function searchDir(dir: string, depth: number) {
		if (depth > 4 || results.length >= limit) return;
		try {
			const entries = await readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (results.length >= limit) break;
				if (
					entry.name.startsWith(".") ||
					FILE_SEARCH_SKIP_DIRS.has(entry.name)
				) {
					continue;
				}
				const full = join(dir, entry.name);
				const rel = relative(resolvedCwd, full);
				if (!entry.isDirectory()) addFile(rel, entry.name);
				if (entry.isDirectory() && depth < 4) await searchDir(full, depth + 1);
			}
		} catch {}
	}

	await searchDir(resolvedCwd, 0);
	return results;
}

function fileRoutes() {
	return {
		"/api/files/search": {
			GET: tryRoute(async (req) => {
				const url = new URL(req.url);
				const explicitCwd = url.searchParams.get("cwd");
				const searchCwds = explicitCwd
					? [resolve(explicitCwd)]
					: await getActiveFileCwds();
				const query = (url.searchParams.get("q") || "").toLowerCase();
				const limit = Math.min(
					Number(url.searchParams.get("limit") || "20") || 20,
					50
				);

				const resolvedCwds = searchCwds.map((cwd) => resolve(cwd));
				if (resolvedCwds.some((cwd) => !isAllowedLocalPath(cwd))) {
					return Response.json({ error: "Invalid directory" }, { status: 400 });
				}

				const perCwdResults = await Promise.all(
					resolvedCwds.map((cwd) => searchFilesInCwd(cwd, query, limit))
				);
				const results: FileSearchRouteResult[] = [];
				for (let index = 0; results.length < limit; index++) {
					let added = false;
					for (const cwdResults of perCwdResults) {
						const result = cwdResults[index];
						if (!result) continue;
						results.push(result);
						added = true;
						if (results.length >= limit) break;
					}
					if (!added) break;
				}

				return Response.json({
					cwd: resolvedCwds[0] ?? PROJECT_ROOT,
					cwds: resolvedCwds,
					results,
				});
			}),
		},

		"/api/files/content": {
			GET: tryRoute(async (req) => {
				const url = new URL(req.url);
				const cwd = url.searchParams.get("cwd") || (await getDefaultFileCwd());
				const filePath = url.searchParams.get("path");
				if (!filePath) {
					return Response.json({ error: "No path provided" }, { status: 400 });
				}

				const resolvedCwd = resolve(cwd);
				if (!isAllowedLocalPath(resolvedCwd)) {
					return Response.json({ error: "Invalid directory" }, { status: 400 });
				}
				const resolvedFile = resolve(resolvedCwd, filePath);
				if (
					!isAllowedLocalPath(resolvedFile) ||
					!isWithinDirectory(resolvedFile, resolvedCwd)
				) {
					return Response.json({ error: "Access denied" }, { status: 403 });
				}

				const info = await stat(resolvedFile);
				if (!info.isFile()) {
					return Response.json({ error: "Not a file" }, { status: 400 });
				}
				if (info.size > 1024 * 1024) {
					return Response.json({ error: "File too large" }, { status: 413 });
				}

				const content = await readFile(resolvedFile, "utf8");
				return Response.json({
					content,
					cwd: resolvedCwd,
					path: relative(resolvedCwd, resolvedFile),
					size: info.size,
					updatedAt: info.mtimeMs,
				});
			}),
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as {
					content?: unknown;
					cwd?: unknown;
					path?: unknown;
				};
				const cwd =
					typeof body.cwd === "string" ? body.cwd : await getDefaultFileCwd();
				const filePath = typeof body.path === "string" ? body.path : "";
				const content = typeof body.content === "string" ? body.content : null;
				if (!filePath) {
					return Response.json({ error: "No path provided" }, { status: 400 });
				}
				if (content === null) {
					return Response.json(
						{ error: "No content provided" },
						{ status: 400 }
					);
				}
				if (content.length > 1024 * 1024) {
					return Response.json({ error: "File too large" }, { status: 413 });
				}

				const resolvedCwd = resolve(cwd);
				if (!isAllowedLocalPath(resolvedCwd)) {
					return Response.json({ error: "Invalid directory" }, { status: 400 });
				}
				const resolvedFile = resolve(resolvedCwd, filePath);
				if (
					!isAllowedLocalPath(resolvedFile) ||
					!isWithinDirectory(resolvedFile, resolvedCwd)
				) {
					return Response.json({ error: "Access denied" }, { status: 403 });
				}

				const info = await stat(resolvedFile);
				if (!info.isFile()) {
					return Response.json({ error: "Not a file" }, { status: 400 });
				}
				await writeFile(resolvedFile, content, "utf8");
				const updated = await stat(resolvedFile);
				return Response.json({
					ok: true,
					cwd: resolvedCwd,
					path: relative(resolvedCwd, resolvedFile),
					size: updated.size,
					updatedAt: updated.mtimeMs,
				});
			}),
		},

		"/api/upload-temp": {
			POST: tryRoute(async (req) => {
				const formData = await req.formData();
				const file = formData.get("file") as File | null;
				if (!file)
					return Response.json({ error: "No file provided" }, { status: 400 });
				if (file.size > MAX_TEMP_UPLOAD_BYTES) {
					return Response.json({ error: "File too large" }, { status: 413 });
				}
				const ext = file.name
					.substring(file.name.lastIndexOf("."))
					.toLowerCase();
				if (!IMAGE_EXTENSIONS.has(ext)) {
					return Response.json(
						{ error: "Unsupported file type" },
						{ status: 400 }
					);
				}
				await mkdir(TMP_DIR, { recursive: true });
				const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
				const filePath = resolve(TMP_DIR, `${Date.now()}-${safeName}`);
				if (!isWithinDirectory(filePath, TMP_DIR)) {
					return Response.json({ error: "Invalid file name" }, { status: 400 });
				}
				await Bun.write(filePath, file);
				return Response.json({ path: filePath });
			}),
		},

		"/api/images": {
			GET: tryRoute(async () => {
				await mkdir(TMP_DIR, { recursive: true });
				const entries = await readdir(TMP_DIR);
				const images: {
					name: string;
					path: string;
					timestamp: number;
					size: number;
				}[] = [];
				for (const entry of entries) {
					const ext = entry.substring(entry.lastIndexOf(".")).toLowerCase();
					if (!IMAGE_EXTENSIONS.has(ext)) continue;
					const full = resolve(TMP_DIR, entry);
					const info = await stat(full);
					const timestampedNameMatch = /^([^-]+)-(.+)$/.exec(entry);
					const ts = timestampedNameMatch
						? Number(timestampedNameMatch[1])
						: info.mtimeMs;
					images.push({
						name: timestampedNameMatch ? timestampedNameMatch[2]! : entry,
						path: full,
						timestamp: ts,
						size: info.size,
					});
				}
				images.sort((a, b) => b.timestamp - a.timestamp);
				return Response.json({ images });
			}),
		},

		"/api/delete-temp": {
			DELETE: tryRoute(async (req) => {
				const url = new URL(req.url);
				const filePath = url.searchParams.get("path");
				if (!filePath)
					return Response.json({ error: "No path provided" }, { status: 400 });
				const resolved = resolve(filePath);
				if (!isWithinDirectory(resolved, TMP_DIR))
					return Response.json({ error: "Access denied" }, { status: 403 });
				const { unlink } = await import("node:fs/promises");
				await unlink(resolved);
				return Response.json({ ok: true });
			}),
		},

		"/api/file": {
			GET: tryRoute(async (req) => {
				const url = new URL(req.url);
				const filePath = url.searchParams.get("path");
				if (!filePath) {
					return Response.json({ error: "No path provided" }, { status: 400 });
				}

				const resolvedPath = await resolveServeableImagePath(filePath);
				if (!resolvedPath) {
					return Response.json({ error: "Access denied" }, { status: 403 });
				}
				const ext = resolvedPath
					.substring(resolvedPath.lastIndexOf("."))
					.toLowerCase();
				if (!IMAGE_EXTENSIONS.has(ext)) {
					return Response.json(
						{ error: "Unsupported file type" },
						{ status: 400 }
					);
				}

				if (!existsSync(resolvedPath)) {
					return Response.json({ error: "File not found" }, { status: 404 });
				}

				const file = Bun.file(resolvedPath);
				if (file.size > MAX_SERVED_FILE_BYTES) {
					return Response.json({ error: "File too large" }, { status: 413 });
				}
				return new Response(file, {
					headers: {
						"Content-Type": file.type || "application/octet-stream",
						"Cache-Control": "no-store",
					},
				});
			}),
		},
	};
}

export function normalizeEntries(value: unknown): Record<string, StoredValue> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return {};
	}
	const entries: Record<string, StoredValue> = {};
	for (const [key, raw] of Object.entries(value)) {
		if (key === TERMINAL_STATE_STORAGE_KEY) {
			if (raw === null) entries[key] = null;
			continue;
		}
		if (!shouldSyncClientStorageKey(key)) continue;
		if (typeof raw === "string" || raw === null) entries[key] = raw;
	}
	return entries;
}

async function loadClientStorageEntries(): Promise<ClientStorageSnapshot> {
	const entries = await readJson<ClientStorageSnapshot>(
		CLIENT_STORAGE_PATH,
		{}
	);
	if (TERMINAL_STATE_STORAGE_KEY in entries) {
		delete entries[TERMINAL_STATE_STORAGE_KEY];
		await writeJson(CLIENT_STORAGE_PATH, entries);
	}
	return entries;
}

async function applyClientStorageEntries(
	entries: Record<string, StoredValue>
): Promise<void> {
	const snapshot = await readJson<ClientStorageSnapshot>(
		CLIENT_STORAGE_PATH,
		{}
	);
	for (const [key, value] of Object.entries(entries)) {
		if (key === TERMINAL_STATE_STORAGE_KEY && value !== null) {
			continue;
		}
		if (value === null) delete snapshot[key];
		else snapshot[key] = value;
	}
	await writeJson(CLIENT_STORAGE_PATH, snapshot);
}

async function applyClientStorageRequest(req: Request): Promise<Response> {
	const body = await req.json();
	const entries = normalizeEntries(body?.entries);
	await applyClientStorageEntries(entries);
	return Response.json({ ok: true });
}

function clientStorageRoutes() {
	return {
		"/api/client-storage": {
			GET: tryRoute(async () => {
				const entries = await loadClientStorageEntries();
				return Response.json({ entries });
			}),
			POST: tryRoute(applyClientStorageRequest),
			PUT: tryRoute(applyClientStorageRequest),
		},
	};
}

function chatEventRoutes() {
	return {
		"/api/chat-events/:paneId": {
			GET: tryRoute(async (req: Request & { params: { paneId: string } }) => {
				const url = new URL(req.url);
				const after = Number(url.searchParams.get("after") ?? "0") || 0;
				const limit = Math.min(
					Math.max(Number(url.searchParams.get("limit") ?? "500") || 500, 1),
					1000
				);
				return Response.json({
					events: await ChatService.readEvents(req.params.paneId, after, limit),
				});
			}),
		},
	};
}

function chatQueueRoutes() {
	return {
		"/api/chat-queues/:paneId": {
			GET: tryRoute(async (req: Request & { params: { paneId: string } }) => {
				return Response.json({
					queue: await ChatService.readQueue(req.params.paneId),
				});
			}),
			PUT: tryRoute(async (req: Request & { params: { paneId: string } }) => {
				const body = await req.json();
				if (!Array.isArray(body?.queue)) {
					return badRequest("Expected queue array");
				}
				await ChatService.saveQueue(req.params.paneId, body.queue);
				return Response.json({ ok: true });
			}),
			DELETE: tryRoute(
				async (req: Request & { params: { paneId: string } }) => {
					await ChatService.deleteQueue(req.params.paneId);
					return Response.json({ ok: true });
				}
			),
		},
	};
}

function checkpointRoutes() {
	return {
		"/api/checkpoints/:paneId": {
			GET: async (req: Request & { params: { paneId: string } }) => {
				const list = CheckpointService.listCheckpoints(req.params.paneId);
				return Response.json({ checkpoints: list });
			},
		},

		"/api/checkpoints/revert/:paneId/:checkpointId": {
			POST: async (
				req: Request & { params: { paneId: string; checkpointId: string } }
			) => {
				const result = await CheckpointService.revertToCheckpoint(
					req.params.checkpointId,
					req.params.paneId
				);
				return Response.json(result);
			},
		},

		"/api/checkpoints/detail/:checkpointId": {
			GET: async (req: Request & { params: { checkpointId: string } }) => {
				const meta = CheckpointService.getCheckpointMeta(
					req.params.checkpointId
				);
				if (!meta) return notFound();
				return Response.json(meta);
			},
		},
	};
}

function goalRoutes() {
	return {
		"/api/goals": {
			GET: tryRoute(async () => {
				return Response.json({ goals: ChatService.listGoals() });
			}),
		},
	};
}

async function loadAutomations(): Promise<AutomationStore> {
	const file = Bun.file(AUTOMATIONS_FILE);
	if (!(await file.exists())) return { flows: [] };
	const data = JSON.parse(await file.text()) as Partial<AutomationStore>;
	return { flows: Array.isArray(data.flows) ? data.flows : [] };
}

function normalizeAutomationStore(
	body: Partial<AutomationStore>
): AutomationStore {
	return {
		flows: Array.isArray(body.flows) ? body.flows : [],
	};
}

async function saveAutomations(
	body: Partial<AutomationStore>
): Promise<AutomationStore> {
	const store = normalizeAutomationStore(body);
	await atomicWriteJson(AUTOMATIONS_FILE, store, 2);
	return store;
}

async function runAutomationOnce(
	body: AutomationRunRequest
): Promise<AutomationRunResult> {
	if (!body.prompt) {
		return { ok: false, status: 400, error: "prompt is required" };
	}

	const result = await runAgentOnce({
		agentKind: "claude",
		prompt: body.prompt,
		cwd: body.cwd || process.cwd(),
		timeoutMs: body.timeoutMs ?? 120_000,
	});
	return { ok: true, result };
}

function automationRoutes() {
	return {
		"/api/automations": {
			GET: tryRoute(async () => {
				return Response.json(await loadAutomations());
			}),
			PUT: tryRoute(async (req) => {
				const body = (await req.json()) as Partial<AutomationStore>;
				return Response.json(await saveAutomations(body));
			}),
		},
		"/api/automations/run": {
			POST: tryRoute(async (req) => {
				const result = await runAutomationOnce(
					(await req.json()) as AutomationRunRequest
				);
				return result.ok
					? Response.json({ result: result.result })
					: Response.json({ error: result.error }, { status: result.status });
			}),
		},
	};
}

function featureRoutes() {
	const routes = {};

	if (FEATURE_FLAGS.goals) {
		Object.assign(routes, goalRoutes());
	}

	if (FEATURE_FLAGS.automations) {
		Object.assign(routes, automationRoutes());
	}

	return routes;
}

function sessionRoutes() {
	return {
		"/api/sessions": {
			GET: tryRoute(async () =>
				Response.json({ sessions: await listLocalSessions() })
			),
		},
	};
}

export function buildApiRoutes() {
	return {
		...agentAccountRoutes(),
		...appInfoRoutes(),
		...configRoutes(),
		...fileRoutes(),
		...forgeRoutes(),
		...nativeRoutes(),
		...terminalRoutes(),
		...chatEventRoutes(),
		...chatQueueRoutes(),
		...clientStorageRoutes(),
		...checkpointRoutes(),
		...promptRoutes(),
		...gitRoutes(),
		...sessionRoutes(),
		...simulatorRoutes(),
		...titleRoutes(),
		...featureRoutes(),
	};
}
