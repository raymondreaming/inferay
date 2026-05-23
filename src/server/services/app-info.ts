import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PROJECT_ROOT } from "../../lib/path-utils.ts";

interface AppInfo {
	name: string;
	version: string;
	hash?: string;
	channel: string;
	identifier?: string;
	production: boolean;
}

const VERSION_JSON_CANDIDATES = [
	resolve(PROJECT_ROOT, "version.json"),
	resolve(dirname(PROJECT_ROOT), "version.json"),
];
const PACKAGE_JSON = resolve(PROJECT_ROOT, "packages/inferay/package.json");

async function readJson(path: string): Promise<Record<string, unknown> | null> {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export async function loadAppInfo(): Promise<AppInfo> {
	let versionInfo: Record<string, unknown> | null = null;
	for (const path of VERSION_JSON_CANDIDATES) {
		versionInfo = await readJson(path);
		if (versionInfo) break;
	}

	if (versionInfo) {
		return {
			name: String(versionInfo.name || "inferay"),
			version: String(versionInfo.version || "dev"),
			hash: typeof versionInfo.hash === "string" ? versionInfo.hash : undefined,
			channel: String(versionInfo.channel || "stable"),
			identifier:
				typeof versionInfo.identifier === "string"
					? versionInfo.identifier
					: undefined,
			production: versionInfo.identifier === "com.inferay.app",
		};
	}

	const pkg = await readJson(PACKAGE_JSON);
	return {
		name: "inferay",
		version: typeof pkg?.version === "string" ? pkg.version : "dev",
		channel: "dev",
		production: false,
	};
}
