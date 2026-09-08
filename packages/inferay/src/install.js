import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { getChannel } from "./config.js";
import { openFile } from "./launch.js";
import {
	defaultInstallPath,
	findExistingApp,
	platformInfo,
} from "./platform.js";
import { downloadAsset, fetchRelease, findAsset } from "./releases.js";

const execFileAsync = promisify(execFile);

async function copyAppBundle(source, destination = defaultInstallPath()) {
	if (!source.endsWith(".app")) {
		throw new Error("local install source must be a .app bundle");
	}
	await mkdir(dirname(destination), { recursive: true });
	await rm(destination, { recursive: true, force: true });
	await cp(source, destination, { recursive: true, force: true });
	return destination;
}

function parseMountPoint(output) {
	return output
		.split("\n")
		.map((line) => line.match(/\/Volumes\/[^\r\n]+/)?.[0].trim())
		.find(Boolean);
}

async function findAppBundle(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const app = entries.find(
		(entry) => entry.isDirectory() && entry.name.endsWith(".app"),
	);
	if (!app) {
		throw new Error(`no .app bundle found in ${directory}`);
	}
	return join(directory, app.name);
}

async function installDmg(dmgPath, { launch = true } = {}) {
	const { stdout } = await execFileAsync("hdiutil", [
		"attach",
		"-nobrowse",
		"-readonly",
		dmgPath,
	]);
	const mountPoint = parseMountPoint(stdout);
	if (!mountPoint) {
		throw new Error("could not determine mounted DMG path");
	}
	try {
		const appBundle = await findAppBundle(mountPoint);
		const destination = await copyAppBundle(appBundle);
		if (launch) {
			await openFile(destination);
		}
		return destination;
	} finally {
		await execFileAsync("hdiutil", ["detach", mountPoint]).catch(() => {});
	}
}

export async function install({ local, launch = true, force = false } = {}) {
	const platform = platformInfo();
	if (!platform.supported) {
		throw new Error(`unsupported platform ${platform.os}-${platform.cpu}`);
	}

	if (local) {
		const source = resolve(local);
		if (!existsSync(source)) {
			throw new Error(`local app not found: ${source}`);
		}
		const destination = await copyAppBundle(source);
		return {
			kind: "local-app",
			message: `Installed ${basename(source)} to ${destination}`,
			installedPath: destination,
		};
	}

	const existing = findExistingApp();
	if (existing) {
		if (!force) {
			return {
				kind: "already-installed",
				message: `Inferay is already available at ${existing}`,
				installedPath: existing,
			};
		}
	}

	const channel = await getChannel();
	const release = await fetchRelease(channel);
	const asset = findAsset(release, platform);
	if (!asset) {
		throw new Error(
			`no ${platform.target} release asset found for ${release.tag_name || channel}`,
		);
	}

	const downloadedPath = await downloadAsset(asset);
	if (downloadedPath.endsWith(".dmg")) {
		const installedPath = await installDmg(downloadedPath, { launch });
		return {
			kind: "dmg-installed",
			message: `Installed ${asset.name} to ${installedPath}`,
			downloadedPath,
			installedPath,
		};
	}

	return {
		kind: "downloaded",
		message: `Downloaded ${asset.name} to ${downloadedPath}`,
		downloadedPath,
	};
}
