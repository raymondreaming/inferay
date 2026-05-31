import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { isActive, isString } from "../../lib/data.ts";
import { badRequest, tryRoute } from "../../lib/route-helpers.ts";
import { resolveAllowedLocalPath } from "../security.ts";
import { ConfigManager } from "../services/config-manager.ts";

const execFileAsync = promisify(execFile);
const configManager = new ConfigManager();
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
				accounts
					.filter((account) => account.state === "success")
					.map((account) => ({
						host,
						login: account.login?.trim() ?? "",
						active: Boolean(account.active),
					}))
					.filter((account) => account.login)
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

export function forgeRoutes() {
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
