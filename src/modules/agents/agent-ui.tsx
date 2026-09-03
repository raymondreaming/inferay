import {
	IconAgent,
	IconAnthropic,
	IconOpenAI,
} from "../../shared/ui/Icons.tsx";
import {
	type AgentIconKey,
	type AgentKind,
	getAgentDefinition,
} from "./agents.ts";

export function getAgentIcon(kind: AgentKind, size = 12, className?: string) {
	const props = { size, className };
	const iconKey: AgentIconKey = getAgentDefinition(kind).iconKey;
	if (iconKey === "anthropic") return <IconAnthropic {...props} />;
	if (iconKey === "openai") return <IconOpenAI {...props} />;
	return <IconAgent {...props} />;
}
