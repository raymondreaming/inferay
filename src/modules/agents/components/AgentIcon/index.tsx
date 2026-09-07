import { createMemo, Match, Switch } from "solid-js";
import type { WorkspaceAgentKind } from "../../../../../build/presentation/contracts/WorkspaceAgentKind.ts";
import { getAgentDefinition } from "../../../../shared/lib/native.tsx";
import {
	IconAgent,
	IconAnthropic,
	IconOpenAI,
} from "../../../../shared/ui/Icons/index.tsx";

export function AgentIcon(props: {
	kind: WorkspaceAgentKind;
	size?: number;
	class?: string;
}) {
	const iconKey = createMemo(() => getAgentDefinition(props.kind).iconKey);
	return (
		<Switch
			fallback={<IconAgent size={props.size ?? 12} class={props.class} />}
		>
			<Match when={iconKey() === "anthropic"}>
				<IconAnthropic size={props.size ?? 12} class={props.class} />
			</Match>
			<Match when={iconKey() === "openai"}>
				<IconOpenAI size={props.size ?? 12} class={props.class} />
			</Match>
		</Switch>
	);
}
