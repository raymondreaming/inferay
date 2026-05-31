import { platform } from "node:os";

export async function openNativePath(
	path: string,
	reveal: boolean
): Promise<boolean> {
	const os = platform();
	const command =
		os === "darwin"
			? reveal
				? ["open", "-R", path]
				: ["open", path]
			: os === "win32"
				? reveal
					? ["explorer.exe", `/select,${path}`]
					: ["explorer.exe", path]
				: ["xdg-open", reveal ? path.replace(/\/[^/]*$/, "") || path : path];
	const proc = Bun.spawn(command, {
		stdout: "ignore",
		stderr: "ignore",
	});
	const exitCode = await proc.exited;
	return exitCode === 0;
}

export async function openNativeUrl(url: string): Promise<boolean> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;

	const os = platform();
	const command =
		os === "darwin"
			? ["open", parsed.toString()]
			: os === "win32"
				? ["cmd", "/c", "start", "", parsed.toString()]
				: ["xdg-open", parsed.toString()];
	const proc = Bun.spawn(command, {
		stdout: "ignore",
		stderr: "ignore",
	});
	const exitCode = await proc.exited;
	return exitCode === 0;
}
