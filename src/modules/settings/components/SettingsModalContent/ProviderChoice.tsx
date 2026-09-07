import * as stylex from "@stylexjs/stylex";
import type { AgentAccountProviderStatus } from "../../../../../build/presentation/contracts/AgentAccountProviderStatus.ts";
import {
	getAgentDefinition,
	type loadDefaultChatSettings,
} from "../../../../shared/lib/native.tsx";
import { AgentIcon } from "../../../agents/components/AgentIcon/index.tsx";
import { styles } from "./styles.ts";
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
	return (
		<button
			type="button"
			onClick={() =>
				_props.updateDefaultChatSettings({
					agentKind: _props.agentKind,
					model: getAgentDefinition(_props.agentKind).defaultModel,
				})
			}
			disabled={
				_props.status ? !_props.connected : _props.agentAccountStatusesLoading
			}
			{...stylex.attrs(
				styles.agentProviderChoice,
				_props.defaultChatSettings.agentKind === _props.agentKind &&
					styles.agentProviderChoiceActive,
			)}
		>
			<span {...stylex.attrs(styles.agentProviderIcon)}>
				<AgentIcon kind={_props.agentKind} size={14} />
			</span>
			<span {...stylex.attrs(styles.agentProviderText)}>
				<strong>{getAgentDefinition(_props.agentKind).label}</strong>
				<span {...stylex.attrs(styles.agentProviderStatus)}>
					{_props.agentAccountStatusesLoading && !_props.status
						? "Checking…"
						: _props.connected
							? "Connected"
							: _props.status?.health === "needs-login"
								? "Login needed"
								: "Not installed"}
				</span>
			</span>
			{_props.defaultChatSettings.agentKind === _props.agentKind ? (
				<span {...stylex.attrs(styles.agentDefaultLabel)}>Default</span>
			) : null}
		</button>
	);
}
