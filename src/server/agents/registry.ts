import type { ChatAgentKind } from "../../features/agents/agents.ts";
import { getAgentDefinition } from "../../features/agents/agents.ts";
import { hasId } from "../../lib/data.ts";
import { claudeAdapter } from "./claude-adapter.ts";
import { codexAdapter } from "./codex-adapter.ts";
import type { AgentAdapter } from "./events.ts";

const adapters: Record<ChatAgentKind, AgentAdapter<any>> = {
	claude: claudeAdapter,
	codex: codexAdapter,
};

export function getAgentAdapter(kind: ChatAgentKind): AgentAdapter<any> {
	return adapters[kind];
}

export function resolveAgentModel(
	agentKind: ChatAgentKind,
	requestedModel?: string
): string | undefined {
	const definition = getAgentDefinition(agentKind);
	if (!definition.models.length) return undefined;
	if (
		requestedModel &&
		definition.models.some(hasId.bind(null, requestedModel))
	) {
		return requestedModel;
	}
	return definition.defaultModel || definition.models[0]?.id;
}
