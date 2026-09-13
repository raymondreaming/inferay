import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_PATH, getChannel } from "./config.js";
import { findExistingApp, platformInfo } from "./platform.js";
import { releaseApiUrl, releaseRepo } from "./releases.js";

async function canAccess(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function commandExists(command) {
	const result = spawnSync("which", [command], { encoding: "utf8" });
	return result.status === 0 ? result.stdout.trim() : null;
}

async function appVersion(appPath) {
	if (!appPath) {
		return null;
	}
	const plist = join(appPath, "Contents/Info.plist");
	if (!existsSync(plist)) {
		return null;
	}
	const result = spawnSync(
		"/usr/libexec/PlistBuddy",
		["-c", "Print :CFBundleShortVersionString", plist],
		{
			encoding: "utf8",
		},
	);
	return result.status === 0 ? result.stdout.trim() : null;
}

export async function doctor({ dev = false } = {}) {
	const platform = platformInfo();
	const appPath = findExistingApp(process.cwd(), { includeDev: dev });
	const [version, channel] = await Promise.all([
		appVersion(appPath),
		getChannel(),
	]);
	const checks = [
		[
			"Platform",
			`${platform.os}-${platform.cpu}${platform.supported ? "" : " (unsupported)"}`,
		],
		["Release repo", releaseRepo()],
		["Release metadata", releaseApiUrl(channel)],
		["Channel", channel],
		[
			"Config",
			(await canAccess(CONFIG_PATH)) ? CONFIG_PATH : "not created yet",
		],
		["Installed app", appPath || "not found"],
		["Installed version", version || "unknown"],
		["Claude CLI", commandExists("claude") || "not found"],
		["Codex CLI", commandExists("codex") || "not found"],
	];

	if (dev) {
		checks.push(["Bun", commandExists("bun") || "not found"]);
		checks.push(["Git", commandExists("git") || "not found"]);
		checks.push([
			"package.json",
			(await canAccess(join(process.cwd(), "package.json")))
				? "found"
				: "not found",
		]);
		try {
			const packageJson = JSON.parse(
				await readFile(join(process.cwd(), "package.json"), "utf8"),
			);
			checks.push(["Project", packageJson.name || "unknown"]);
		} catch {
			checks.push(["Project", "unknown"]);
		}
	}

	return checks;
}
