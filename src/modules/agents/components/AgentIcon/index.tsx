import type { AgentIconKey } from "../../../../../build/presentation/contracts/AgentIconKey.ts";
import type { WorkspaceAgentKind } from "../../../../../build/presentation/contracts/WorkspaceAgentKind.ts";
import { getAgentDefinition } from "../../../../adapters/backend/http.ts";
import {
	IconAgent,
	IconAnthropic,
	IconOpenAI,
} from "../../../../shared/ui/Icons/index.tsx";

export function getAgentIcon(
	kind: WorkspaceAgentKind,
	size = 12,
	className?: string,
) {
	const props = { size, className };
	const iconKey: AgentIconKey = getAgentDefinition(kind).iconKey;
	if (iconKey === "anthropic") return <IconAnthropic {...props} />;
	if (iconKey === "openai") return <IconOpenAI {...props} />;
	return <IconAgent {...props} />;
}
