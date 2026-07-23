import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PROJECT_ROOT } from "../../lib/user-data.ts";

const BINARY_NAME = "inferay-native-diff";
const MAX_NATIVE_PAYLOAD_BYTES = 512 * 1024;
const NATIVE_CORE_TIMEOUT_MS = 10_000;

function candidatePaths(): string[] {
	return [
		resolve(PROJECT_ROOT, "native/bin", BINARY_NAME),
		resolve(PROJECT_ROOT, "native/diff-engine/target/release", BINARY_NAME),
		resolve(PROJECT_ROOT, "native/diff-engine/target/debug", BINARY_NAME),
	];
}

export function resolveNativeCoreBinary(): string | null {
	for (const path of candidatePaths()) {
		if (existsSync(path)) return path;
	}
	return null;
}

export async function runNativeCore<TRequest, TResponse>(
	payload: TRequest
): Promise<TResponse | null> {
	const binary = resolveNativeCoreBinary();
	if (!binary) return null;
	const serialized = JSON.stringify(payload);
	if (Buffer.byteLength(serialized, "utf8") > MAX_NATIVE_PAYLOAD_BYTES)
		return null;

	try {
		const proc = Bun.spawn([binary], {
			stdin: new Blob([serialized]),
			stdout: "pipe",
			stderr: "pipe",
		});
		const timeout = setTimeout(() => {
			try {
				proc.kill();
			} catch {}
		}, NATIVE_CORE_TIMEOUT_MS);

		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		clearTimeout(timeout);

		if (exitCode !== 0) {
			console.error("[native-core] sidecar failed:", stderr.trim());
			return null;
		}

		return JSON.parse(stdout) as TResponse;
	} catch (error) {
		console.error("[native-core] execution failed:", error);
		return null;
	}
}
