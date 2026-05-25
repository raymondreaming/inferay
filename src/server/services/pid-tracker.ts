import { atomicWriteJson } from "../../lib/atomic-write.ts";
import { userDataPath } from "../../lib/user-data.ts";

const PID_FILE = userDataPath("runtime-pids.json");
const isWin = process.platform === "win32";

const _g = globalThis as any;
if (!_g.__surgent_activePids) _g.__surgent_activePids = new Set<number>();
const activePids: Set<number> = _g.__surgent_activePids;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveChain: Promise<void> = Promise.resolve();

async function writePids(): Promise<void> {
	await atomicWriteJson(PID_FILE, [...activePids]);
}

function scheduleSave(): void {
	if (saveTimer) return;
	saveTimer = setTimeout(() => {
		saveTimer = null;
		saveChain = saveChain
			.then(writePids)
			.catch((e) => console.error("[PID] save error:", e));
	}, 200);
}

function treeKill(pid: number): void {
	if (!Number.isSafeInteger(pid) || pid <= 0) return;
	try {
		if (isWin) {
			Bun.spawnSync(["taskkill", "/T", "/F", "/PID", String(pid)], {
				stdio: ["ignore", "ignore", "ignore"],
			});
			return;
		}
	} catch {}

	try {
		const result = Bun.spawnSync(["pgrep", "-P", String(pid)]);
		if (result.stdout) {
			for (const childPid of result.stdout
				.toString()
				.trim()
				.split("\n")
				.filter(Boolean)) {
				treeKill(Number(childPid));
			}
		}
	} catch {}

	try {
		process.kill(pid, "SIGTERM");
	} catch {}
}

export const PidTracker = {
	trackPid(pid: number): void {
		if (!Number.isSafeInteger(pid) || pid <= 0) return;
		activePids.add(pid);
		scheduleSave();
	},

	untrackPid(pid: number): void {
		if (!Number.isSafeInteger(pid) || pid <= 0) return;
		activePids.delete(pid);
		scheduleSave();
	},

	killPid(pid: number): void {
		treeKill(pid);
	},

	async cleanupOrphans(): Promise<void> {
		try {
			const file = Bun.file(PID_FILE);
			if (await file.exists()) {
				const pids = (await file.json()) as unknown;
				if (Array.isArray(pids) && pids.length > 0) {
					for (const pid of pids.filter(
						(pid): pid is number => Number.isSafeInteger(pid) && pid > 0
					)) {
						treeKill(pid);
					}
				}
			}
		} catch (e) {
			console.error("[PID] orphan cleanup error:", e);
		}
		activePids.clear();
		await writePids();
	},

	async flush(): Promise<void> {
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		saveChain = saveChain
			.then(writePids)
			.catch((e) => console.error("[PID] flush error:", e));
		return saveChain;
	},
};
