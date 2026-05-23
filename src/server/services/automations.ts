import { atomicWriteJson } from "../../lib/atomic-write.ts";
import { userDataPath } from "../../lib/user-data.ts";
import { runAgentOnce } from "./agent-once.ts";

const AUTOMATIONS_FILE = userDataPath("automations.json");

export interface AutomationStore {
	flows: unknown[];
}

export interface AutomationRunRequest {
	prompt?: string;
	cwd?: string;
	timeoutMs?: number;
}

export type AutomationRunResult =
	| { ok: true; result: string | null }
	| { ok: false; status: number; error: string };

export async function loadAutomations(): Promise<AutomationStore> {
	const file = Bun.file(AUTOMATIONS_FILE);
	if (!(await file.exists())) return { flows: [] };
	const data = JSON.parse(await file.text()) as Partial<AutomationStore>;
	return { flows: Array.isArray(data.flows) ? data.flows : [] };
}

export function normalizeAutomationStore(
	body: Partial<AutomationStore>
): AutomationStore {
	return {
		flows: Array.isArray(body.flows) ? body.flows : [],
	};
}

export async function saveAutomations(
	body: Partial<AutomationStore>
): Promise<AutomationStore> {
	const store = normalizeAutomationStore(body);
	await atomicWriteJson(AUTOMATIONS_FILE, store, 2);
	return store;
}

export async function runAutomationOnce(
	body: AutomationRunRequest
): Promise<AutomationRunResult> {
	if (!body.prompt) {
		return { ok: false, status: 400, error: "prompt is required" };
	}

	const result = await runAgentOnce({
		agentKind: "claude",
		prompt: body.prompt,
		cwd: body.cwd || process.cwd(),
		timeoutMs: body.timeoutMs ?? 120_000,
	});
	return { ok: true, result };
}
