import * as stylex from "@octanejs/stylex";
import type { AgentAccountProviderStatus } from "../../../../../build/presentation/contracts/AgentAccountProviderStatus.ts";
import type {
	getAgentDefinition,
	loadDefaultChatSettings,
} from "../../../../adapters/backend/http.ts";
import { DropdownButton } from "../../../../shared/ui/DropdownButton/index.tsx";
import { SettingsErrorBanner } from "../SettingsStatus/index.tsx";
import { ProviderChoice } from "./ProviderChoice.tsx";
import { SettingsSection } from "./SettingsSection.tsx";
import { styles } from "./styles.ts";

export function ChatDefaultsSettings({
	agentAccountStatusesError,
	refreshAgentAccountStatuses,
	agentAccountStatuses,
	agentAccountStatusesLoading,
	defaultChatSettings,
	updateDefaultChatSettings,
	defaultModelOptions,
	defaultAgentDefinition,
}: {
	agentAccountStatusesError: string | null;
	refreshAgentAccountStatuses: () => void;
	agentAccountStatuses: AgentAccountProviderStatus[];
	agentAccountStatusesLoading: boolean;
	defaultChatSettings: ReturnType<typeof loadDefaultChatSettings>;
	updateDefaultChatSettings: (
		next: Partial<ReturnType<typeof loadDefaultChatSettings>>,
	) => void;
	defaultModelOptions: Parameters<typeof DropdownButton>[0]["options"];
	defaultAgentDefinition: ReturnType<typeof getAgentDefinition>;
}) {
	return (
		<SettingsSection
			id="agent-defaults"
			title="New chats"
			description="The provider, model, and reasoning level used by default."
			onRefresh={refreshAgentAccountStatuses}
		>
			{agentAccountStatusesError ? (
				<SettingsErrorBanner message={agentAccountStatusesError} />
			) : null}
			<div {...stylex.props(styles.agentDefaultsControl)}>
				<div {...stylex.props(styles.settingField)}>
					<span {...stylex.props(styles.settingLabel)}>Provider</span>
					<div {...stylex.props(styles.agentProviderGrid)}>
						{(["claude", "codex"] as const).map((agentKind) => {
							const status = agentAccountStatuses.find(
								(item) => item.kind === agentKind,
							);
							const connected = status?.health === "ready";
							return (
								<ProviderChoice
									key={agentKind}
									agentKind={agentKind}
									status={status}
									connected={connected}
									agentAccountStatusesLoading={agentAccountStatusesLoading}
									defaultChatSettings={defaultChatSettings}
									updateDefaultChatSettings={updateDefaultChatSettings}
								/>
							);
						})}
					</div>
				</div>
				<div {...stylex.props(styles.defaultSettingsGrid)}>
					{(
						[
							{
								key: "model",
								label: "Model",
								options: defaultModelOptions,
							},
							...(defaultChatSettings.agentKind === "codex"
								? [
										{
											key: "reasoningLevel",
											label: "Reasoning",
											options: defaultAgentDefinition.reasoningLevels,
										},
									]
								: []),
						] as const
					).map((field) => (
						<div key={field.key} {...stylex.props(styles.settingField)}>
							<span {...stylex.props(styles.settingLabel)}>{field.label}</span>
							<DropdownButton
								liquid={false}
								value={
									field.key === "model"
										? defaultChatSettings.model
										: defaultChatSettings.reasoningLevel
								}
								options={field.options}
								onChange={(value) =>
									updateDefaultChatSettings({ [field.key]: value })
								}
								fullWidth
								buttonClassName={
									stylex.props(styles.settingsDropdown).className
								}
							/>
						</div>
					))}
				</div>
			</div>
		</SettingsSection>
	);
}
