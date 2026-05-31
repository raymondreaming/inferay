import { atomicWriteJson } from "../../lib/atomic-write.ts";
import { userDataPath } from "../../lib/user-data.ts";

const PID_FILE = userDataPath("runtime-pids.json");
const isWin = process.platform === "win32";
const OWNER_ID = String(process.pid);

const _g = globalThis as any;
if (!_g.__surgent_activePids) _g.__surgent_activePids = new Set<number>();
const activePids: Set<number> = _g.__surgent_activePids;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveChain: Promise<void> = Promise.resolve();

interface PidOwnerEntry {
	ownerPid: number;
	pids: number[];
	updatedAt: number;
}

interface PidRegistry {
	version: 2;
	owners: Record<string, PidOwnerEntry>;
}

function emptyRegistry(): PidRegistry {
	return { version: 2, owners: {} };
}

function isPidAlive(pid: number): boolean {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function normalizeRegistry(value: unknown): PidRegistry {
	if (
		value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		(value as Partial<PidRegistry>).version === 2 &&
		typeof (value as Partial<PidRegistry>).owners === "object" &&
		(value as Partial<PidRegistry>).owners !== null
	) {
		const registry = emptyRegistry();
		for (const [ownerId, rawEntry] of Object.entries(
			(value as PidRegistry).owners
		)) {
			if (!rawEntry || typeof rawEntry !== "object") continue;
			const ownerPid = Number(rawEntry.ownerPid);
			const pids = Array.isArray(rawEntry.pids)
				? rawEntry.pids.filter(
						(pid): pid is number => Number.isSafeInteger(pid) && pid > 0
					)
				: [];
			if (
				!Number.isSafeInteger(ownerPid) ||
				ownerPid <= 0 ||
				pids.length === 0
			) {
				continue;
			}
			registry.owners[ownerId] = {
				ownerPid,
				pids,
				updatedAt: Number(rawEntry.updatedAt) || 0,
			};
		}
		return registry;
	}

	return emptyRegistry();
}

async function readRegistry(): Promise<PidRegistry> {
	const file = Bun.file(PID_FILE);
	if (!(await file.exists())) return emptyRegistry();
	try {
		return normalizeRegistry(await file.json());
	} catch {
		return emptyRegistry();
	}
}

async function writePids(): Promise<void> {
	const registry = await readRegistry();
	if (activePids.size > 0) {
		registry.owners[OWNER_ID] = {
			ownerPid: process.pid,
			pids: [...activePids],
			updatedAt: Date.now(),
		};
	} else {
		delete registry.owners[OWNER_ID];
	}
	await atomicWriteJson(PID_FILE, registry);
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
			const registry = await readRegistry();
			for (const [ownerId, entry] of Object.entries(registry.owners)) {
				if (ownerId === OWNER_ID || isPidAlive(entry.ownerPid)) continue;
				for (const pid of entry.pids) treeKill(pid);
				delete registry.owners[ownerId];
			}
			await atomicWriteJson(PID_FILE, registry);
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
