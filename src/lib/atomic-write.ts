import { renameSync } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Atomically write JSON data to a file.
 * Writes to a .tmp sibling first, then renames into place.
 * Prevents partial/corrupt writes on crash or slow I/O (Windows/OneDrive).
 */
export async function atomicWriteJson(
	filePath: string,
	data: unknown,
	indent?: number
): Promise<void> {
	const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random()
		.toString(36)
		.slice(2)}.tmp`;
	await mkdir(dirname(filePath), { recursive: true });
	try {
		await Bun.write(tmpPath, JSON.stringify(data, null, indent));
		renameSync(tmpPath, filePath);
	} catch (error) {
		await unlink(tmpPath).catch(() => {});
		throw error;
	}
}
