import type { AgentContextUpdate, EffectiveAgentContext } from "@contracts";
import { fetchJson, postJson } from "@shared/lib/native.tsx";

export function loadAgentContext(
	paneId: string,
	cwd?: string,
	signal?: AbortSignal,
) {
	const params = new URLSearchParams({ paneId });
	if (cwd) params.set("cwd", cwd);
	return fetchJson<EffectiveAgentContext>(`/api/agent-context?${params}`, {
		signal,
	});
}

export function saveAgentContext(input: {
	scope: AgentContextUpdate["scope"];
	instructions: string;
	mode: "inherit" | "replace";
	cwd?: string;
	paneId: string;
}) {
	return postJson("/api/agent-context", input, { method: "PUT" });
}
