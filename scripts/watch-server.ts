/**
 * Watches server-side sources and the Bun entrypoint for .ts changes and
 * restarts the electrobun dev process when they change.
 */
import { existsSync, watch } from "node:fs";
import { resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { resolveExitCode } from "./watch-utils.ts";

const ROOT = process.cwd();
const ELECTROBUN =
	Bun.which("electrobun", {
		PATH: `./node_modules/electrobun/.cache:./node_modules/.bin`,
	}) ?? "./node_modules/.bin/electrobun";

const watchTargets = [
	{ path: resolve(ROOT, "src/server"), recursive: true },
	{ path: resolve(ROOT, "src/lib"), recursive: true },
	{ path: resolve(ROOT, "src/index.ts"), recursive: false },
].filter((target) => existsSync(target.path));

let child: ReturnType<typeof spawn> | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;
let restarting = false;

function execFileText(cmd: string, args: string[]): Promise<string> {
	return new Promise((resolve) => {
		execFile(cmd, args, (error, stdout) => {
			resolve(error ? "" : stdout);
		});
	});
}

async function getDevAppPids(): Promise<number[]> {
	if (process.platform !== "darwin") return [];
	const outputs = await Promise.all([
		execFileText("pgrep", ["-x", "inferay-dev"]),
		execFileText("pgrep", ["-f", "inferay-dev.app/Contents/MacOS"]),
	]);
	const pids = new Set<number>();
	for (const output of outputs) {
		for (const line of output.split("\n")) {
			const pid = Number.parseInt(line.trim(), 10);
			if (Number.isFinite(pid) && pid > 0) pids.add(pid);
		}
	}
	return [...pids].sort((a, b) => a - b);
}

async function killDevApps(): Promise<void> {
	const pids = await getDevAppPids();
	for (const pid of pids) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {}
	}
}

function runElectrobun(args: string[]): Promise<number> {
	return new Promise((resolve) => {
		const proc = spawn(ELECTROBUN, args, {
			stdio: "inherit",
			env: { ...process.env, TERMINAL_GUI_APP_ROOT: ROOT },
		});
		proc.on("exit", resolveExitCode.bind(null, resolve));
		proc.on("error", resolve.bind(null, 1));
	});
}

async function killChild(): Promise<void> {
	if (!child) return;
	const proc = child;
	child = null;
	return new Promise<void>((resolve) => {
		const timeout = setTimeout(() => {
			proc.kill("SIGKILL");
		}, 5000);
		proc.on("exit", () => {
			clearTimeout(timeout);
			resolve();
		});
		proc.kill("SIGTERM");
	});
}

async function startApp() {
	if (restarting) return;
	restarting = true;
	try {
		await killChild();
		await killDevApps();
		// Brief pause to let ports and file locks release
		await new Promise((r) => setTimeout(r, 200));
		child = spawn(ELECTROBUN, ["dev"], {
			stdio: "inherit",
			env: { ...process.env, TERMINAL_GUI_APP_ROOT: ROOT },
		});
		child.on("exit", (code) => {
			if (child?.killed) return;
			child = null;
		});
	} finally {
		restarting = false;
	}
}

for (const target of watchTargets) {
	watch(target.path, { recursive: target.recursive }, (_event, filename) => {
		if (!filename?.endsWith(".ts")) return;
		if (debounce) clearTimeout(debounce);
		debounce = setTimeout(startApp, 800);
	});
}

startApp();

async function shutdown() {
	await killChild();
	await killDevApps();
	process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
