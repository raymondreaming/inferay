import * as stylex from "@stylexjs/stylex";
import { createMemo, For } from "solid-js";
import type { AgentAccountProviderStatus } from "../../../../../build/presentation/contracts/AgentAccountProviderStatus.ts";
import type {
	getAgentDefinition,
	loadDefaultChatSettings,
} from "../../../../shared/lib/native.tsx";
import { DropdownButton } from "../../../../shared/ui/DropdownButton/index.tsx";
import { SettingsErrorBanner } from "../SettingsStatus/index.tsx";
import { ProviderChoice } from "./ProviderChoice.tsx";
import { SettingsSection } from "./SettingsSection.tsx";
import { styles } from "./styles.ts";
export function ChatDefaultsSettings(_props: {
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
			onRefresh={_props.refreshAgentAccountStatuses}
		>
			{_props.agentAccountStatusesError ? (
				<SettingsErrorBanner message={_props.agentAccountStatusesError} />
			) : null}
			<div {...stylex.attrs(styles.agentDefaultsControl)}>
				<div {...stylex.attrs(styles.settingField)}>
					<span {...stylex.attrs(styles.settingLabel)}>Provider</span>
					<div {...stylex.attrs(styles.agentProviderGrid)}>
						{(["claude", "codex"] as const).map((agentKind) => {
							const status = createMemo(() =>
								_props.agentAccountStatuses.find(
									(item) => item.kind === agentKind,
								),
							);
							const connected = createMemo(() => status()?.health === "ready");
							return (
								<ProviderChoice
									agentKind={agentKind}
									status={status()}
									connected={connected()}
									agentAccountStatusesLoading={
										_props.agentAccountStatusesLoading
									}
									defaultChatSettings={_props.defaultChatSettings}
									updateDefaultChatSettings={_props.updateDefaultChatSettings}
								/>
							);
						})}
					</div>
				</div>
				<div {...stylex.attrs(styles.defaultSettingsGrid)}>
					{
						<For
							each={
								[
									{
										key: "model",
										label: "Model",
										options: _props.defaultModelOptions,
									},
									...(_props.defaultChatSettings.agentKind === "codex"
										? [
												{
													key: "reasoningLevel",
													label: "Reasoning",
													options:
														_props.defaultAgentDefinition.reasoningLevels,
												},
											]
										: []),
								] as const
							}
							keyed={(row) => row.key}
						>
							{(field) => (
								<div {...stylex.attrs(styles.settingField)}>
									<span {...stylex.attrs(styles.settingLabel)}>
										{field().label}
									</span>
									<DropdownButton
										liquid={false}
										value={
											field().key === "model"
												? _props.defaultChatSettings.model
												: _props.defaultChatSettings.reasoningLevel
										}
										options={field().options}
										onChange={(value) =>
											_props.updateDefaultChatSettings({
												[field().key]: value,
											})
										}
										fullWidth
										buttonClassName={
											stylex.attrs(styles.settingsDropdown).class
										}
									/>
								</div>
							)}
						</For>
					}
				</div>
			</div>
		</SettingsSection>
	);
}
