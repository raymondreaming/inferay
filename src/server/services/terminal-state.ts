import { writeJson } from "../../lib/route-helpers.ts";
import { userDataPath } from "../../lib/user-data.ts";

const TERMINAL_STATE_PATH = userDataPath("terminal-state.json");

async function readJsonFile<T>(path: string): Promise<T | null> {
	const file = Bun.file(path);
	if (!(await file.exists())) return null;
	try {
		return (await file.json()) as T;
	} catch {
		return null;
	}
}

export async function readTerminalState<T>(fallback: T): Promise<T> {
	return (await readJsonFile<T>(TERMINAL_STATE_PATH)) ?? fallback;
}

export function writeTerminalState(data: unknown): Promise<void> {
	return writeJson(TERMINAL_STATE_PATH, data);
}
