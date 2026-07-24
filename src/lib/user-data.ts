import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

function resolveProjectRoot(): string {
	if (process.env.AGENT_GUI_APP_ROOT) {
		return process.env.AGENT_GUI_APP_ROOT;
	}
	const bundleRoot = resolve(import.meta.dir, "..");
	if (existsSync(resolve(bundleRoot, "views"))) {
		return bundleRoot;
	}
	return resolve(import.meta.dir, "../..");
}

const USER_DATA_ROOT = (() => {
	if (platform() === "darwin") {
		return join(homedir(), "Library", "Application Support", "Inferay");
	}
	if (platform() === "win32") {
		return join(process.env.APPDATA || homedir(), "Inferay");
	}
	return join(
		process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
		"inferay"
	);
})();

export const PROJECT_ROOT = resolveProjectRoot();

export function userDataPath(...parts: string[]): string {
	return join(USER_DATA_ROOT, ...parts);
}
