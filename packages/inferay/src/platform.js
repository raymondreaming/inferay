import { existsSync } from "node:fs";
import { arch, homedir, platform } from "node:os";
import { join, resolve } from "node:path";

export function platformInfo() {
	const os = platform();
	const cpu = arch();
	if (os !== "darwin") {
		return { os, cpu, supported: false, target: `${os}-${cpu}` };
	}
	const mappedArch = cpu === "arm64" ? "arm64" : cpu === "x64" ? "x64" : cpu;
	return {
		os: "macos",
		cpu: mappedArch,
		supported: mappedArch === "arm64" || mappedArch === "x64",
		target: `macos-${mappedArch}`,
	};
}

export function defaultInstallPath() {
	return "/Applications/inferay.app";
}

function installedAppCandidates() {
	return [join(homedir(), "Applications/inferay.app"), defaultInstallPath()];
}

function devAppCandidates(cwd = process.cwd()) {
	return [
		resolve(cwd, "build/gpui/Inferay Native.app"),
		resolve(cwd, "build/rust-macos-arm64/inferay.app"),
	];
}

export function findExistingApp(
	cwd = process.cwd(),
	{ includeDev = false } = {},
) {
	const candidates = includeDev
		? [...devAppCandidates(cwd), ...installedAppCandidates()]
		: installedAppCandidates();
	return candidates.find((candidate) => existsSync(candidate));
}
