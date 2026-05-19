import { exec } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";
import type { Subprocess } from "bun";
import { $ } from "bun";
import { compareName, isString, uniqueTrimmedStrings } from "../../lib/data.ts";
import { isBootedSimulatorDevice } from "../../lib/simulator-utils.ts";
import { resolveAllowedLocalPath } from "../security.ts";
import { ConfigManager } from "./config-manager.ts";
import { readTerminalState } from "./terminal-state.ts";

export interface SimulatorDevice {
	udid: string;
	name: string;
	state: "Booted" | "Shutdown" | string;
	runtime: string;
	isAvailable: boolean;
}

export interface BaguetteStatus {
	installed: boolean;
	running: boolean;
	port: number;
	baseUrl: string;
	error?: string;
}

export interface SimulatorProject {
	id: string;
	name: string;
	kind: "xcode" | "react-native";
	path: string;
	projectPath?: string;
	workspacePath?: string;
	iosPath?: string;
	schemes: string[];
	defaultScheme?: string;
	bundleId?: string | null;
	bootedDeviceUdid?: string | null;
	installed: boolean;
	running: boolean;
}

interface InstalledSimulatorApp {
	bundleId: string;
	displayName: string | null;
	name: string | null;
	executable: string | null;
}

interface SimctlDeviceListEntry {
	udid: string;
	name: string;
	state: string;
	isAvailable?: boolean;
}

interface BuildTarget {
	path: string;
	projectPath?: string;
	workspacePath?: string;
	iosPath?: string;
}

let baguetteProcess: Subprocess | null = null;
const configManager = new ConfigManager();
const execAsync = promisify(exec);

const BAGUETTE_PORT = 8421;
const BAGUETTE_HOST = "127.0.0.1";
const BAGUETTE_BASE_URL = `http://${BAGUETTE_HOST}:${BAGUETTE_PORT}`;
const BAGUETTE_CANDIDATES = [
	process.env.BAGUETTE_BIN,
	"/opt/homebrew/bin/baguette",
	"/usr/local/bin/baguette",
	"baguette",
].filter(Boolean) as string[];

const SCAN_SKIP_DIRS = new Set([
	".git",
	".next",
	".turbo",
	"build",
	"DerivedData",
	"dist",
	"node_modules",
	"Pods",
	".build",
]);

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
	return path;
}

function toDisplayPath(path: string): string {
	const home = homedir();
	const cleaned = path.replace(/\/+$/, "");
	return cleaned.startsWith(`${home}/`)
		? `~/${cleaned.slice(home.length + 1)}`
		: cleaned;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

async function getWorkspacePaths(): Promise<string[]> {
	const data = await readTerminalState<{
		groups?: Array<{
			panes?: Array<{ cwd?: string; referencePaths?: string[] }>;
		}>;
	} | null>(null);
	if (!data) return [];
	try {
		const paths = new Set<string>();
		for (const group of data.groups ?? []) {
			for (const pane of group.panes ?? []) {
				if (pane.cwd) paths.add(pane.cwd);
				for (const ref of pane.referencePaths ?? []) paths.add(ref);
			}
		}
		return [...paths];
	} catch {
		return [];
	}
}

async function getProjectSearchRoots(): Promise<string[]> {
	const config = await configManager.load();
	const simulatorFolders = Array.isArray(config.simulator_project_folders)
		? config.simulator_project_folders.filter(isString)
		: [];
	const configured = Array.isArray(config.search_folders)
		? config.search_folders.filter(isString)
		: [];
	const roots = new Set<string>();
	for (const root of [
		...simulatorFolders,
		...configured,
		...(await getWorkspacePaths()),
	]) {
		const expanded = expandHome(root);
		if (await pathExists(expanded)) roots.add(expanded);
	}
	return [...roots];
}

async function findSimulatorBuildTargets(
	root: string,
	depth = 4
): Promise<BuildTarget[]> {
	const found = new Map<string, BuildTarget>();
	async function addTarget(dir: string, entryName: string) {
		const fullPath = resolve(dir, entryName);
		const appRoot = basename(dir) === "ios" ? dirname(dir) : dir;
		const existing = found.get(appRoot) ?? { path: appRoot };
		if (entryName.endsWith(".xcworkspace")) {
			existing.workspacePath = fullPath;
			existing.iosPath = dir;
		} else if (!existing.projectPath) {
			existing.projectPath = fullPath;
			existing.iosPath = basename(dir) === "ios" ? dir : undefined;
		}
		found.set(appRoot, existing);
	}
	async function scan(dir: string, remaining: number) {
		if (remaining < 0) return;
		let entries: Array<{ name: string; isDirectory(): boolean }>;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
			const fullPath = resolve(dir, entry.name);
			if (
				entry.name.endsWith(".xcodeproj") ||
				entry.name.endsWith(".xcworkspace")
			) {
				await addTarget(dir, entry.name);
				continue;
			}
			if (SCAN_SKIP_DIRS.has(entry.name)) continue;
			await scan(fullPath, remaining - 1);
		}
	}
	await scan(root, depth);
	return [...found.values()];
}

export async function getSimulatorProjectFolders(): Promise<string[]> {
	const config = await configManager.load();
	return Array.isArray(config.simulator_project_folders)
		? config.simulator_project_folders.filter(isString)
		: [];
}

export async function setSimulatorProjectFolders(
	folders: string[]
): Promise<string[]> {
	const normalized = uniqueTrimmedStrings(folders.map(toDisplayPath));
	const config = await configManager.update({
		simulator_project_folders: normalized,
	});
	return Array.isArray(config.simulator_project_folders)
		? config.simulator_project_folders.filter(isString)
		: normalized;
}

export async function pickSimulatorProjectFolder(): Promise<string | null> {
	try {
		let folderPath: string | null = null;
		if (platform() === "darwin") {
			const { stdout } = await execAsync(
				`osascript -e 'POSIX path of (choose folder with prompt "Select an Xcode or React Native project folder")'`,
				{ encoding: "utf-8", timeout: 120000 }
			);
			folderPath = stdout.trim() || null;
		} else if (platform() === "win32") {
			const { stdout } = await execAsync(
				`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; if($f.ShowDialog() -eq 'OK'){$f.SelectedPath}"`,
				{ encoding: "utf-8", timeout: 120000 }
			);
			folderPath = stdout.trim() || null;
		}
		return folderPath ? toDisplayPath(folderPath) : null;
	} catch {
		return null;
	}
}

export async function autoDetectSimulatorProjectFolders(): Promise<string[]> {
	const config = await configManager.load();
	const configured = Array.isArray(config.search_folders)
		? config.search_folders.filter(isString)
		: [];
	const candidates = uniqueTrimmedStrings([
		"~/Desktop",
		"~/Desktop/Code",
		"~/Desktop/HatchingPoint",
		"~/Desktop/RealityDesigners",
		"~/Code",
		"~/Developer",
		...configured,
		...(await getWorkspacePaths()),
	]);
	const detected = new Set<string>();
	for (const root of candidates) {
		const expanded = expandHome(root);
		if (!(await pathExists(expanded))) continue;
		for (const target of await findSimulatorBuildTargets(expanded, 5)) {
			detected.add(toDisplayPath(target.path));
		}
	}
	const merged = uniqueTrimmedStrings([
		...(await getSimulatorProjectFolders()),
		...detected,
	]);
	return setSimulatorProjectFolders(merged);
}

async function getSchemes(target: BuildTarget): Promise<string[]> {
	try {
		const result = target.workspacePath
			? await $`xcodebuild -workspace ${target.workspacePath} -list -json`
					.quiet()
					.nothrow()
			: await $`xcodebuild -project ${target.projectPath} -list -json`
					.quiet()
					.nothrow();
		if (result.exitCode !== 0) return [];
		const data = JSON.parse(result.stdout.toString());
		return Array.isArray(data.project?.schemes)
			? data.project.schemes
			: Array.isArray(data.workspace?.schemes)
				? data.workspace.schemes
				: [];
	} catch {
		return [];
	}
}

async function getBundleIdFromProject(
	target: BuildTarget,
	scheme?: string
): Promise<string | null> {
	if (scheme) {
		try {
			const result = target.workspacePath
				? await $`xcodebuild -workspace ${target.workspacePath} -scheme ${scheme} -showBuildSettings`
						.quiet()
						.nothrow()
				: await $`xcodebuild -project ${target.projectPath} -scheme ${scheme} -showBuildSettings`
						.quiet()
						.nothrow();
			const match = result.stdout
				.toString()
				.match(/^ {4}PRODUCT_BUNDLE_IDENTIFIER = (.+)$/m);
			if (match?.[1]) return match[1].trim();
		} catch {}
	}
	try {
		const pbxproj = await readFile(
			resolve(target.projectPath ?? "", "project.pbxproj"),
			"utf-8"
		);
		const match = pbxproj.match(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/);
		return match?.[1]?.replace(/"/g, "").trim() || null;
	} catch {
		return null;
	}
}

async function getInstalledApps(
	udid: string
): Promise<InstalledSimulatorApp[]> {
	try {
		const result = await $`xcrun simctl listapps ${udid}`.quiet().nothrow();
		const text = result.stdout.toString();
		const apps: InstalledSimulatorApp[] = [];
		for (const match of text.matchAll(/"([^"]+)" =\s+\{([\s\S]*?)\n {4}\};/g)) {
			const block = match[2] ?? "";
			const valueFor = (key: string) =>
				block
					.match(new RegExp(`${key} = (?:"([^"]+)"|([^;\\n]+));`))
					?.slice(1)
					.find(Boolean)
					?.trim() ?? null;
			if (match[1]) {
				apps.push({
					bundleId: match[1],
					displayName: valueFor("CFBundleDisplayName"),
					name: valueFor("CFBundleName"),
					executable: valueFor("CFBundleExecutable"),
				});
			}
		}
		return apps;
	} catch {
		return [];
	}
}

function normalizeAppName(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findInstalledAppForProject(
	apps: InstalledSimulatorApp[],
	projectName: string
): InstalledSimulatorApp | null {
	const normalizedProject = normalizeAppName(projectName);
	return (
		apps.find((app) =>
			[app.displayName, app.name, app.executable, app.bundleId]
				.filter((value): value is string => !!value)
				.some((value) => normalizeAppName(value) === normalizedProject)
		) ?? null
	);
}

async function getRunningBundleSnapshot(udid: string): Promise<string> {
	try {
		const result = await $`xcrun simctl spawn ${udid} launchctl print system`
			.quiet()
			.nothrow();
		return result.stdout.toString();
	} catch {
		return "";
	}
}

async function resolveBaguetteBinary(): Promise<string | null> {
	for (const candidate of BAGUETTE_CANDIDATES) {
		const help = Bun.spawnSync([candidate, "--help"], {
			stdout: "ignore",
			stderr: "ignore",
		});
		if (help.exitCode === 0) return candidate;
	}
	return null;
}

async function isBaguetteServerRunning(): Promise<boolean> {
	try {
		const res = await fetch(`${BAGUETTE_BASE_URL}/simulators.json`, {
			signal: AbortSignal.timeout(800),
		});
		return res.ok;
	} catch {
		return false;
	}
}

export async function getBaguetteStatus(): Promise<BaguetteStatus> {
	const binary = await resolveBaguetteBinary();
	const running = binary ? await isBaguetteServerRunning() : false;
	return {
		installed: !!binary,
		running,
		port: BAGUETTE_PORT,
		baseUrl: BAGUETTE_BASE_URL,
		error: binary ? undefined : "baguette is not installed",
	};
}

export async function startBaguetteServer(): Promise<BaguetteStatus> {
	const status = await getBaguetteStatus();
	if (!status.installed || status.running) return status;

	const binary = await resolveBaguetteBinary();
	if (!binary) return status;

	baguetteProcess = Bun.spawn(
		[binary, "serve", "--host", BAGUETTE_HOST, "--port", String(BAGUETTE_PORT)],
		{
			stdout: "ignore",
			stderr: "ignore",
			env: process.env,
		}
	);
	baguetteProcess.exited.finally(() => {
		baguetteProcess = null;
	});

	for (let attempt = 0; attempt < 15; attempt++) {
		await Bun.sleep(250);
		if (await isBaguetteServerRunning()) return getBaguetteStatus();
	}

	return {
		...status,
		running: false,
		error: "baguette serve did not become ready",
	};
}

export function parseSimctlDevices(data: unknown): SimulatorDevice[] {
	if (!data || typeof data !== "object") return [];
	const runtimes = (data as { devices?: unknown }).devices;
	if (!runtimes || typeof runtimes !== "object") return [];
	const devices: SimulatorDevice[] = [];

	for (const [runtime, deviceList] of Object.entries(runtimes)) {
		if (!Array.isArray(deviceList)) continue;
		for (const device of deviceList as SimctlDeviceListEntry[]) {
			if (!device.udid || !device.name || device.isAvailable === false)
				continue;
			devices.push({
				udid: device.udid,
				name: device.name,
				state: device.state ?? "Unknown",
				runtime: runtime.replace("com.apple.CoreSimulator.SimRuntime.", ""),
				isAvailable: device.isAvailable !== false,
			});
		}
	}

	return devices;
}

export async function listSimulators(): Promise<SimulatorDevice[]> {
	try {
		const result = await $`xcrun simctl list devices -j`.quiet();
		return parseSimctlDevices(JSON.parse(result.stdout.toString()));
	} catch (error) {
		const stderr =
			typeof (error as { stderr?: { toString(): string } })?.stderr
				?.toString === "function"
				? (error as { stderr: { toString(): string } }).stderr.toString().trim()
				: "";
		const message =
			stderr ||
			(error instanceof Error ? error.message : "Failed to list simulators");
		throw new Error(message);
	}
}

export async function bootSimulator(
	udid: string
): Promise<{ ok: boolean; error?: string }> {
	try {
		await $`xcrun simctl boot ${udid}`.quiet();
		return { ok: true };
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Failed to boot simulator";
		if (message.includes("Unable to boot device in current state: Booted")) {
			return { ok: true };
		}
		return { ok: false, error: message };
	}
}

export async function shutdownSimulator(
	udid: string
): Promise<{ ok: boolean; error?: string }> {
	try {
		await $`xcrun simctl shutdown ${udid}`.quiet().nothrow();
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			error:
				error instanceof Error ? error.message : "Failed to shutdown simulator",
		};
	}
}

export async function openSimulatorApp(udid?: string): Promise<void> {
	if (udid) await $`xcrun simctl boot ${udid}`.quiet().nothrow();
	await $`open -a Simulator`.quiet();
}

export async function listSimulatorProjects(): Promise<SimulatorProject[]> {
	const roots = await getProjectSearchRoots();
	const targets = new Map<string, BuildTarget>();
	for (const root of roots) {
		for (const target of await findSimulatorBuildTargets(root)) {
			targets.set(target.path, target);
		}
	}

	const bootedDevice = (await listSimulators()).find(isBootedSimulatorDevice);
	const installedApps = bootedDevice
		? await getInstalledApps(bootedDevice.udid)
		: [];
	const installed = new Set(installedApps.map((app) => app.bundleId));
	const runningSnapshot = bootedDevice
		? await getRunningBundleSnapshot(bootedDevice.udid)
		: "";

	const projects: SimulatorProject[] = [];
	for (const target of targets.values()) {
		const fallbackName = basename(
			target.workspacePath ?? target.projectPath ?? target.path,
			target.workspacePath ? ".xcworkspace" : ".xcodeproj"
		);
		const projectName = basename(target.path);
		const projectBundleId = await getBundleIdFromProject(target);
		const installedApp =
			(projectBundleId
				? installedApps.find((app) => app.bundleId === projectBundleId)
				: null) ?? findInstalledAppForProject(installedApps, projectName);
		const bundleId = installedApp?.bundleId ?? projectBundleId;
		projects.push({
			id: target.workspacePath ?? target.projectPath ?? target.path,
			name: projectName,
			kind: target.iosPath ? "react-native" : "xcode",
			path: target.path,
			projectPath: target.projectPath,
			workspacePath: target.workspacePath,
			iosPath: target.iosPath,
			schemes: [],
			defaultScheme: fallbackName,
			bundleId,
			bootedDeviceUdid: bootedDevice?.udid ?? null,
			installed: bundleId ? installed.has(bundleId) : false,
			running: bundleId ? runningSnapshot.includes(bundleId) : false,
		});
	}

	return projects.sort(compareName);
}

export async function openXcodeProject(
	appPath: string
): Promise<string | null> {
	const safeAppPath = resolveAllowedLocalPath(appPath);
	if (!safeAppPath) return null;
	const targets = await findSimulatorBuildTargets(safeAppPath, 2);
	const target =
		targets[0] ??
		(safeAppPath.endsWith(".xcodeproj")
			? { path: dirname(safeAppPath), projectPath: safeAppPath }
			: safeAppPath.endsWith(".xcworkspace")
				? { path: dirname(safeAppPath), workspacePath: safeAppPath }
				: null);
	const openPath = target?.workspacePath ?? target?.projectPath;
	if (!openPath) return null;
	await $`open ${openPath}`.quiet();
	return openPath;
}

async function buildApp(
	target: BuildTarget,
	scheme: string,
	udid: string
): Promise<{ ok: boolean; appPath?: string; error?: string }> {
	const derivedDataPath = resolve(tmpdir(), `inferay-sim-build-${Date.now()}`);
	try {
		const build = target.workspacePath
			? await $`xcodebuild -workspace ${target.workspacePath} -scheme ${scheme} -sdk iphonesimulator -destination id=${udid} -configuration Debug -derivedDataPath ${derivedDataPath} build`
					.quiet()
					.nothrow()
			: await $`xcodebuild -project ${target.projectPath} -scheme ${scheme} -sdk iphonesimulator -destination id=${udid} -configuration Debug -derivedDataPath ${derivedDataPath} build`
					.quiet()
					.nothrow();
		if (build.exitCode !== 0) {
			return {
				ok: false,
				error: build.stderr.toString().slice(0, 1200) || "Build failed",
			};
		}
		const productsDir = resolve(
			derivedDataPath,
			"Build/Products/Debug-iphonesimulator"
		);
		const builtApp = (await readdir(productsDir)).find((name) =>
			name.endsWith(".app")
		);
		if (!builtApp)
			return { ok: false, error: "Build succeeded but .app not found" };
		return { ok: true, appPath: resolve(productsDir, builtApp) };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : "Build failed",
		};
	}
}

export async function buildInstallLaunchProject({
	appPath,
	udid,
	scheme,
}: {
	appPath: string;
	udid: string;
	scheme?: string;
}): Promise<{
	ok: boolean;
	projectPath?: string;
	scheme?: string;
	bundleId?: string | null;
	appBundlePath?: string;
	error?: string;
}> {
	const safeAppPath = resolveAllowedLocalPath(appPath);
	if (!safeAppPath) {
		return { ok: false, error: "Project path is outside allowed local roots" };
	}
	const target =
		(await findSimulatorBuildTargets(safeAppPath, 2))[0] ??
		(safeAppPath.endsWith(".xcodeproj")
			? { path: dirname(safeAppPath), projectPath: safeAppPath }
			: safeAppPath.endsWith(".xcworkspace")
				? { path: dirname(safeAppPath), workspacePath: safeAppPath }
				: null);
	if (!target) return { ok: false, error: "No Xcode project found" };
	const schemes = await getSchemes(target);
	const resolvedScheme =
		(scheme &&
			schemes.find((item) => item.toLowerCase() === scheme.toLowerCase())) ??
		schemes[0] ??
		basename(target.workspacePath ?? target.projectPath ?? target.path).replace(
			/\.(xcworkspace|xcodeproj)$/,
			""
		);

	const build = await buildApp(target, resolvedScheme, udid);
	if (!build.ok || !build.appPath) return { ok: false, error: build.error };

	const install = await $`xcrun simctl install ${udid} ${build.appPath}`
		.quiet()
		.nothrow();
	if (install.exitCode !== 0) {
		return {
			ok: false,
			error: install.stderr.toString().slice(0, 1200) || "Install failed",
		};
	}

	const bundleId =
		(await getBundleIdFromProject(target, resolvedScheme)) ??
		(await readBuiltBundleId(build.appPath));
	if (bundleId) {
		await $`xcrun simctl terminate ${udid} ${bundleId}`.quiet().nothrow();
		const launch = await $`xcrun simctl launch ${udid} ${bundleId}`
			.quiet()
			.nothrow();
		if (launch.exitCode !== 0) {
			return {
				ok: false,
				error: launch.stderr.toString().slice(0, 1200) || "Launch failed",
			};
		}
	}

	return {
		ok: true,
		projectPath: target.projectPath ?? target.workspacePath,
		scheme: resolvedScheme,
		bundleId,
		appBundlePath: build.appPath,
	};
}

async function readBuiltBundleId(
	appBundlePath: string
): Promise<string | null> {
	try {
		const result =
			await $`/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" ${resolve(appBundlePath, "Info.plist")}`
				.quiet()
				.nothrow();
		return result.stdout.toString().trim() || null;
	} catch {
		return null;
	}
}
