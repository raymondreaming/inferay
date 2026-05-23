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
