import { createMemo } from "solid-js";
import type { AgentIconKey } from "../../../../../build/presentation/contracts/AgentIconKey.ts";
import type { WorkspaceAgentKind } from "../../../../../build/presentation/contracts/WorkspaceAgentKind.ts";
import { getAgentDefinition } from "../../../../shared/lib/native.tsx";
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
	const props = createMemo(() => ({
		size,
		class: className,
	}));
	const iconKey = createMemo<AgentIconKey>(
		() => getAgentDefinition(kind).iconKey,
	);
	if (iconKey() === "anthropic") return <IconAnthropic {...props()} />;
	if (iconKey() === "openai") return <IconOpenAI {...props()} />;
	return <IconAgent {...props()} />;
}
