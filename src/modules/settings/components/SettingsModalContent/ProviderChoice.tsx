import { AgentIcon } from "@agents/components/AgentIcon/index.tsx";
import type { AgentAccountProviderStatus } from "@contracts";
import {
	getAgentDefinition,
	type loadDefaultChatSettings,
} from "@shared/lib/native.tsx";
import { SettingsSegment } from "@shared/ui/SettingsSurface/index.tsx";
export function ProviderChoice(_props: {
	agentKind: "claude" | "codex";
	status: AgentAccountProviderStatus | undefined;
	connected: boolean;
	agentAccountStatusesLoading: boolean;
	defaultChatSettings: ReturnType<typeof loadDefaultChatSettings>;
	updateDefaultChatSettings: (
		next: Partial<ReturnType<typeof loadDefaultChatSettings>>,
	) => void;
}) {
	const label = () => getAgentDefinition(_props.agentKind).label;
	return (
		<SettingsSegment
			selected={_props.defaultChatSettings.agentKind === _props.agentKind}
			disabled={
				_props.status ? !_props.connected : _props.agentAccountStatusesLoading
			}
			title={
				_props.agentAccountStatusesLoading && !_props.status
					? `${label()} · Checking…`
					: _props.connected
						? `${label()} · Connected`
						: _props.status?.health === "needs-login"
							? `${label()} · Login needed`
							: `${label()} · Not installed`
			}
			icon={<AgentIcon kind={_props.agentKind} size={12} />}
			onSelect={() =>
				_props.updateDefaultChatSettings({
					agentKind: _props.agentKind,
					model: getAgentDefinition(_props.agentKind).defaultModel,
				})
			}
		>
			{label()}
		</SettingsSegment>
	);
}
