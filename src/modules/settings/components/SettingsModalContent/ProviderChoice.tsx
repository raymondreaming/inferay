import * as stylex from "@octanejs/stylex";
import type { AgentAccountProviderStatus } from "../../../../../build/presentation/contracts/AgentAccountProviderStatus.ts";
import {
	getAgentDefinition,
	type loadDefaultChatSettings,
} from "../../../../adapters/backend/http.ts";
import { getAgentIcon } from "../../../agents/components/AgentIcon/index.tsx";
import { styles } from "./styles.ts";

export function ProviderChoice({
	agentKind,
	status,
	connected,
	agentAccountStatusesLoading,
	defaultChatSettings,
	updateDefaultChatSettings,
}: {
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
			key={agentKind}
			type="button"
			onClick={() =>
				updateDefaultChatSettings({
					agentKind,
					model: getAgentDefinition(agentKind).defaultModel,
				})
			}
			disabled={status ? !connected : agentAccountStatusesLoading}
			{...stylex.props(
				styles.agentProviderChoice,
				defaultChatSettings.agentKind === agentKind &&
					styles.agentProviderChoiceActive,
			)}
		>
			<span {...stylex.props(styles.agentProviderIcon)}>
				{getAgentIcon(agentKind, 14)}
			</span>
			<span {...stylex.props(styles.agentProviderText)}>
				<strong>{getAgentDefinition(agentKind).label}</strong>
				<span {...stylex.props(styles.agentProviderStatus)}>
					{agentAccountStatusesLoading && !status
						? "Checking…"
						: connected
							? "Connected"
							: status?.health === "needs-login"
								? "Login needed"
								: "Not installed"}
				</span>
			</span>
			{defaultChatSettings.agentKind === agentKind ? (
				<span {...stylex.props(styles.agentDefaultLabel)}>Default</span>
			) : null}
		</button>
	);
}
