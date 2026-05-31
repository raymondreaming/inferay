import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { ServerWebSocket } from "bun";
import type { AgentKind } from "../../features/agents/agents.ts";
import {
	createAgentEnv,
	resolveInteractiveAgentCommand,
} from "../../features/terminal/terminal-command.ts";
import {
	compareName,
	hasPid,
	hasPpid,
	isFirstPath,
	ppidNotIn,
} from "../../lib/data.ts";
import { PROJECT_ROOT } from "../../lib/path-utils.ts";
import { badRequest, tryRoute } from "../../lib/route-helpers.ts";
import { isAllowedLocalPath, resolveAllowedLocalPath } from "../security.ts";
import { ChatService } from "../services/agent-chat.ts";
import { ConfigManager } from "../services/config-manager.ts";
import { PidTracker } from "../services/pid-tracker.ts";
import {
	readTerminalState,
	writeTerminalState,
} from "../services/terminal-state.ts";

const configManager = new ConfigManager();

const isWin = process.platform === "win32";

class OutputBuffer {
	private chunks: string[] = [];
	private totalLength = 0;
	private readonly maxLength: number;

	constructor(maxBytes = 64 * 1024) {
		this.maxLength = maxBytes;
	}

	push(data: string) {
		this.chunks.push(data);
		this.totalLength += data.length;
		while (this.totalLength > this.maxLength && this.chunks.length > 1) {
			const removed = this.chunks.shift()!;
			this.totalLength -= removed.length;
		}
	}

	drain(): string {
		return this.chunks.join("");
	}
}

interface TerminalSession {
	terminal: InstanceType<typeof Bun.Terminal>;
	proc: ReturnType<typeof Bun.spawn>;
	agentKind: AgentKind;
	paneId: string;
	ws: ServerWebSocket<any> | null;
	outputBuffer: OutputBuffer;
	decoder: TextDecoder;
}

const g = globalThis as any;
if (!g.__inferay_terminalSessions)
	g.__inferay_terminalSessions = new Map<string, TerminalSession>();
const sessions: Map<string, TerminalSession> = g.__inferay_terminalSessions;

function killProcessTree(pid: number): void {
	if (isWin) {
		try {
			Bun.spawnSync(["taskkill", "/PID", String(pid), "/T", "/F"], {
				stdio: ["ignore", "ignore", "ignore"],
			});
		} catch {}
		return;
	}

	try {
		const result = Bun.spawnSync(["pgrep", "-P", String(pid)]);
		if (result.stdout) {
			for (const childPid of result.stdout
				.toString()
				.trim()
				.split("\n")
				.filter(Boolean)) {
				killProcessTree(Number(childPid));
			}
		}
	} catch {}

	try {
		process.kill(pid, "SIGTERM");
	} catch {}
}

function sendToClient(session: TerminalSession, msg: object) {
	if (session.ws?.readyState === 1) {
		session.ws.send(JSON.stringify(msg));
	}
}

export const TerminalService = {
	async createPane(
		paneId: string,
		agentKind: AgentKind,
		ws: ServerWebSocket<any>,
		cols = 80,
		rows = 24,
		cwd?: string
	): Promise<{ ok: boolean; error?: string }> {
		if (sessions.has(paneId))
			return { ok: false, error: "Pane already exists" };

		const resolved = await resolveInteractiveAgentCommand(
			agentKind,
			PROJECT_ROOT
		);
		if ("error" in resolved) return { ok: false, error: resolved.error };

		try {
			const outputBuffer = new OutputBuffer();
			const decoder = new TextDecoder("utf-8");

			const terminal = new Bun.Terminal({
				cols,
				rows,
				data(_term, data) {
					const session = sessions.get(paneId);
					if (session) {
						const text = session.decoder.decode(data, { stream: true });
						session.outputBuffer.push(text);
						sendToClient(session, {
							type: "terminal:output",
							paneId,
							data: text,
						});
					}
				},
			});

			const spawnEnv =
				agentKind === "claude"
					? { ...createAgentEnv("claude"), TERM: "xterm-256color" }
					: { ...process.env, TERM: "xterm-256color" };
			const spawnCwd = cwd ? resolveAllowedLocalPath(cwd) : process.cwd();
			if (!spawnCwd) {
				return { ok: false, error: "Invalid working directory" };
			}
			const proc = Bun.spawn(resolved.cmd, {
				terminal,
				env: spawnEnv,
				cwd: spawnCwd,
			});

			const session: TerminalSession = {
				terminal,
				proc,
				agentKind,
				paneId,
				ws,
				outputBuffer,
				decoder,
			};
			sessions.set(paneId, session);
			if (proc.pid) PidTracker.trackPid(proc.pid);

			proc.exited.then((code) => {
				const s = sessions.get(paneId);
				if (s) {
					if (s.proc.pid) PidTracker.untrackPid(s.proc.pid);
					sendToClient(s, { type: "terminal:exit", paneId, exitCode: code });
					terminal.close();
					sessions.delete(paneId);
				}
			});

			return { ok: true };
		} catch (e) {
			return {
				ok: false,
				error: e instanceof Error ? e.message : "Failed to spawn process",
			};
		}
	},

	write(paneId: string, data: string): { ok: boolean; error?: string } {
		const session = sessions.get(paneId);
		if (!session) return { ok: false, error: "Pane not found" };
		try {
			session.terminal.write(data);
			return { ok: true };
		} catch (e) {
			return {
				ok: false,
				error: e instanceof Error ? e.message : "Failed to write",
			};
		}
	},

	resize(paneId: string, cols: number, rows: number): { ok: boolean } {
		const session = sessions.get(paneId);
		if (!session) return { ok: false };
		try {
			session.terminal.resize(cols, rows);
		} catch {}
		return { ok: true };
	},

	destroyPane(paneId: string): { ok: boolean } {
		const session = sessions.get(paneId);
		if (!session) return { ok: true };
		try {
			if (session.proc.pid) {
				killProcessTree(session.proc.pid);
				PidTracker.untrackPid(session.proc.pid);
			}
			session.terminal.close();
		} catch {}
		sessions.delete(paneId);
		return { ok: true };
	},

	cleanupWs(ws: ServerWebSocket<any>) {
		for (const session of sessions.values())
			if (session.ws === ws) session.ws = null;
	},

	reassignWs(
		paneId: string,
		ws: ServerWebSocket<any>
	): { ok: boolean; buffer?: string } {
		const session = sessions.get(paneId);
		if (!session) return { ok: false };
		session.ws = ws;
		const buffer = session.outputBuffer.drain();
		return { ok: true, buffer: buffer || undefined };
	},

	listSessions() {
		return Array.from(sessions.values()).map((s) => ({
			paneId: s.paneId,
			agentKind: s.agentKind,
		}));
	},

	destroyAll() {
		for (const [paneId, session] of sessions) {
			try {
				if (session.proc.pid) {
					killProcessTree(session.proc.pid);
					PidTracker.untrackPid(session.proc.pid);
				}
			} catch {}
			try {
				session.terminal.close();
			} catch {}
			sessions.delete(paneId);
		}
	},
};

function isRealFolder(name: string): boolean {
	const excluded = [".app", ".bundle", ".plugin", ".kext", ".framework"];
	return !excluded.some((ext) => name.toLowerCase().endsWith(ext));
}

async function getConfiguredSearchPaths(): Promise<string[]> {
	const home = homedir();
	const config = await configManager.load();
	const folders = config.search_folders;
	if (!Array.isArray(folders) || folders.length === 0) {
		return [
			resolve(home, "Desktop"),
			resolve(home, "Documents"),
			resolve(home, "Projects"),
			resolve(home, "Developer"),
			resolve(home, "Code"),
			resolve(home, "Work"),
			resolve(home, "Sites"),
			resolve(home, "repos"),
			resolve(home, "src"),
			resolve(home, "dev"),
		];
	}
	return folders
		.map((f: string) =>
			f.startsWith("~/") ? resolve(home, f.slice(2)) : resolve(f)
		)
		.filter(isAllowedLocalPath);
}

async function listDirectories(
	basePath: string
): Promise<Array<{ name: string; path: string }>> {
	const safeBasePath = resolveAllowedLocalPath(basePath);
	if (!safeBasePath) return [];
	const results: Array<{ name: string; path: string }> = [];
	try {
		const entries = await readdir(safeBasePath, { withFileTypes: true });
		for (const entry of entries) {
			if (
				entry.isDirectory() &&
				!entry.name.startsWith(".") &&
				isRealFolder(entry.name)
			) {
				results.push({
					name: entry.name,
					path: resolve(safeBasePath, entry.name),
				});
			}
		}
	} catch {}
	return results.sort(compareName);
}

async function searchDirectories(
	query: string
): Promise<Array<{ name: string; path: string }>> {
	type DirEntry = { name: string; path: string };
	const exactMatches: DirEntry[] = [];
	const prefixMatches: DirEntry[] = [];
	const containsMatches: DirEntry[] = [];

	const home = homedir();
	const configuredPaths = await getConfiguredSearchPaths();
	const searchPaths = [home, ...configuredPaths, resolve(PROJECT_ROOT, "apps")];

	const lowerQuery = query.toLowerCase();

	const categorizeMatch = (dir: { name: string; path: string }) => {
		const lowerName = dir.name.toLowerCase();
		if (lowerName === lowerQuery) exactMatches.push(dir);
		else if (lowerName.startsWith(lowerQuery)) prefixMatches.push(dir);
		else if (lowerName.includes(lowerQuery)) containsMatches.push(dir);
	};

	async function scanForMatches(
		basePath: string,
		depth: number
	): Promise<void> {
		if (depth <= 0) return;
		try {
			const dirs = await listDirectories(basePath);
			for (const dir of dirs) {
				categorizeMatch(dir);
				await scanForMatches(dir.path, depth - 1);
			}
		} catch {}
	}

	for (const searchPath of searchPaths) {
		try {
			await stat(searchPath);
			// Home dir gets 1 level (its children are the common paths already listed)
			// Common paths get 3 levels deep to match quickPicks scan depth
			const depth = searchPath === home ? 1 : 3;
			await scanForMatches(searchPath, depth);
		} catch {}
	}

	const seen = new Set<string>();
	return [...exactMatches, ...prefixMatches, ...containsMatches]
		.filter(isFirstPath.bind(null, seen))
		.slice(0, 20);
}

async function findQuickPicks(): Promise<
	Array<{ name: string; path: string; isGitRepo: boolean }>
> {
	const commonPaths = await getConfiguredSearchPaths();

	const results: Array<{
		name: string;
		path: string;
		isGitRepo: boolean;
		mtime: number;
	}> = [];

	async function checkGitRepo(dirPath: string, name: string): Promise<boolean> {
		try {
			const gitStat = await stat(resolve(dirPath, ".git"));
			if (gitStat.isDirectory()) {
				const dirStat = await stat(dirPath);
				results.push({
					name,
					path: dirPath,
					isGitRepo: true,
					mtime: dirStat.mtimeMs,
				});
				return true;
			}
		} catch {}
		return false;
	}

	async function scanDir(dirPath: string, depth: number): Promise<void> {
		if (depth <= 0) return;
		try {
			const entries = await readdir(dirPath, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
				const fullPath = resolve(dirPath, entry.name);
				if (!(await checkGitRepo(fullPath, entry.name))) {
					await scanDir(fullPath, depth - 1);
				}
			}
		} catch {}
	}

	for (const basePath of commonPaths) {
		try {
			const stats = await stat(basePath);
			if (!stats.isDirectory()) continue;
			await scanDir(basePath, 3);
		} catch {}
	}

	results.sort((a, b) => b.mtime - a.mtime);
	const seen = new Set<string>();
	return results
		.filter(isFirstPath.bind(null, seen))
		.slice(0, 8)
		.map(({ name, path, isGitRepo }) => ({ name, path, isGitRepo }));
}

interface ClaudeProcess {
	pid: number;
	ppid: number;
	cpu: number;
	mem: number;
	rss: number;
	cwd: string;
	command: string;
	elapsed: string;
}

async function getClaudeProcesses(): Promise<ClaudeProcess[]> {
	try {
		if (isWin) return [];
		const output = (
			await Bun.$`ps -eo pid,ppid,pcpu,pmem,rss,etime,comm,args`
				.quiet()
				.nothrow()
		).text();
		const processes: ClaudeProcess[] = [];

		for (const line of output.trim().split("\n").slice(1)) {
			const parts = line.trim().split(/\s+/);
			if (parts.length < 8 || parts[6] !== "claude") continue;

			const pidText = parts[0];
			if (!pidText) continue;
			const pid = parseInt(pidText, 10);
			if (pid === process.pid) continue;

			let cwd = "";
			try {
				const cwdOutput = (
					await Bun.$`/usr/sbin/lsof -p ${pid} -Fn 2>/dev/null | grep '^n/' | head -1`
						.quiet()
						.nothrow()
				)
					.text()
					.trim();
				if (cwdOutput.startsWith("n/")) cwd = cwdOutput.slice(1);
			} catch {}

			processes.push({
				pid,
				ppid: parseInt(parts[1] ?? "0", 10),
				cpu: parseFloat(parts[2] ?? "0"),
				mem: parseFloat(parts[3] ?? "0"),
				rss: parseInt(parts[4] ?? "0", 10),
				cwd,
				command: parts.slice(7).join(" "),
				elapsed: parts[5] ?? "",
			});
		}

		const claudePids = new Set(processes.map((p) => p.pid));
		return processes.filter(ppidNotIn.bind(null, claudePids)).map((parent) => {
			const children = processes.filter(hasPpid.bind(null, parent.pid));
			return {
				...parent,
				cpu:
					Math.round(
						children.reduce((sum, c) => sum + c.cpu, parent.cpu) * 10
					) / 10,
				rss: children.reduce((sum, c) => sum + c.rss, parent.rss),
				mem:
					Math.round(
						children.reduce((sum, c) => sum + c.mem, parent.mem) * 10
					) / 10,
			};
		});
	} catch {
		return [];
	}
}

async function killClaudeProcess(
	pid: number
): Promise<{ ok: boolean; error?: string }> {
	try {
		killProcessTree(pid);
		await new Promise((r) => setTimeout(r, 500));
		try {
			process.kill(pid, 0);
			process.kill(pid, "SIGKILL");
		} catch {}
		return { ok: true };
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : "Failed to kill process",
		};
	}
}

async function killAllClaudeProcesses(): Promise<{
	ok: boolean;
	killed: number;
}> {
	try {
		await Bun.$`pkill -9 -f "^claude"`.quiet().nothrow();
		await Bun.$`killall -9 claude`.quiet().nothrow();
	} catch {}
	return { ok: true, killed: 0 };
}

function requirePid(req: Request): Promise<{ pid: number } | Response> {
	return req.json().then(({ pid }) => {
		if (!Number.isSafeInteger(pid) || pid <= 0) {
			return badRequest("Invalid pid");
		}
		return { pid };
	});
}

export function terminalRoutes() {
	return {
		"/api/terminal/state": {
			GET: tryRoute(async () => {
				return Response.json(await readTerminalState<unknown | null>(null));
			}),
			POST: tryRoute(async (req) => {
				await writeTerminalState(await req.json());
				return Response.json({ ok: true });
			}),
		},
		"/api/terminal/list": {
			GET: () => Response.json({ sessions: TerminalService.listSessions() }),
		},
		"/api/terminal/agent-sessions": {
			GET: () => Response.json({ sessions: ChatService.listSessions() }),
		},
		"/api/terminal/claude-processes": {
			GET: tryRoute(async () =>
				Response.json({ processes: await getClaudeProcesses() })
			),
		},
		"/api/terminal/claude-processes/kill": {
			POST: tryRoute(async (req) => {
				const parsed = await requirePid(req);
				if (parsed instanceof Response) return parsed;
				const processes = await getClaudeProcesses();
				if (!processes.some(hasPid.bind(null, parsed.pid))) {
					return Response.json(
						{ error: "PID is not a listed Claude process" },
						{ status: 403 }
					);
				}
				return Response.json(await killClaudeProcess(parsed.pid));
			}),
		},
		"/api/terminal/claude-processes/kill-all": {
			POST: tryRoute(async () => Response.json(await killAllClaudeProcesses())),
		},
		"/api/terminal/directories": {
			GET: tryRoute(async (req) => {
				const url = new URL(req.url);
				const query = url.searchParams.get("q") || "";
				const path = url.searchParams.get("path");

				if (path) {
					const resolvedPath = resolveAllowedLocalPath(path);
					if (!resolvedPath) {
						return Response.json(
							{ error: "Path is outside allowed local roots" },
							{ status: 403 }
						);
					}
					const parentPath = dirname(resolvedPath);
					const parent =
						parentPath !== resolvedPath && resolveAllowedLocalPath(parentPath)
							? parentPath
							: null;
					return Response.json({
						directories: await listDirectories(resolvedPath),
						parent,
					});
				}
				if (query) {
					return Response.json({
						directories: await searchDirectories(query),
						parent: null,
					});
				}

				const home = homedir();
				if (url.searchParams.get("quickPicks") === "true") {
					return Response.json({ quickPicks: await findQuickPicks(), home });
				}

				return Response.json({
					directories: await listDirectories(home),
					parent: null,
					home,
				});
			}),
		},
	};
}
