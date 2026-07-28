import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));

function resolveProjectRoot(): string {
	if (process.env.AGENT_GUI_APP_ROOT) {
		return process.env.AGENT_GUI_APP_ROOT;
	}
	const bundleRoot = resolve(MODULE_DIRECTORY, "..");
	if (existsSync(resolve(bundleRoot, "views"))) {
		return bundleRoot;
	}
	return resolve(MODULE_DIRECTORY, "../..");
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
