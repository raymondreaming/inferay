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

const VERSION_JSON_CANDIDATES = [
	resolve(PROJECT_ROOT, "version.json"),
	resolve(dirname(PROJECT_ROOT), "version.json"),
];
const PACKAGE_JSON = resolve(PROJECT_ROOT, "packages/inferay/package.json");
const DEFAULT_RELEASE_REPO = "raymondreaming/inferay";
const RELEASE_CHECK_TIMEOUT_MS = 1500;
const RELEASE_CHECK_CACHE_TTL_MS = 15 * 60 * 1000;

let releaseCheckCache: {
	key: string;
	expiresAt: number;
	info: AppUpdateInfo;
} | null = null;

async function readJson(path: string): Promise<Record<string, unknown> | null> {
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

export async function loadAppInfo(): Promise<AppInfo> {
	let versionInfo: Record<string, unknown> | null = null;
	for (const path of VERSION_JSON_CANDIDATES) {
		versionInfo = await readJson(path);
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

	const pkg = await readJson(PACKAGE_JSON);
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
