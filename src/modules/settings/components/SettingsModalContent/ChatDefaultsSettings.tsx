import type { AgentAccountProviderStatus } from "@contracts";
import * as stylex from "@stylexjs/stylex";
import { createMemo, For } from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import type {
	getAgentDefinition,
	loadDefaultChatSettings,
} from "../../../../shared/lib/native.tsx";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import { DropdownButton } from "../../../../shared/ui/DropdownButton/index.tsx";
import { IconRefreshCw } from "../../../../shared/ui/Icons/index.tsx";
import {
	SettingsRow,
	SettingsSection,
	SettingsSegmented,
} from "../../../../shared/ui/SettingsSurface/index.tsx";
import { SettingsErrorBanner } from "../SettingsStatus/index.tsx";
import { ProviderChoice } from "./ProviderChoice.tsx";
import { styles } from "./styles.ts";

const PROVIDERS = ["claude", "codex"] as const;
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
	const activeStatus = createMemo(() =>
		_props.agentAccountStatuses.find(
			(item) => item.kind === _props.defaultChatSettings.agentKind,
		),
	);
	const activeStatusLabel = createMemo(() =>
		_props.agentAccountStatusesLoading && !activeStatus()
			? "Checking accounts…"
			: activeStatus()?.health === "ready"
				? `${_props.defaultAgentDefinition.label} is connected.`
				: activeStatus()?.health === "needs-login"
					? `${_props.defaultAgentDefinition.label} needs a login.`
					: `${_props.defaultAgentDefinition.label} is not installed.`,
	);
	return (
		<SettingsSection
			id="agent-defaults"
			title="New chats"
			description="The provider, model, and reasoning level used by default."
			action={
				<Button
					liquid={false}
					type="button"
					onClick={_props.refreshAgentAccountStatuses}
					variant="ghost"
					size="sm"
					class={stylex.attrs(styles.noShrink).class}
				>
					<IconRefreshCw size={iconSize.md} />
					<span>Refresh</span>
				</Button>
			}
		>
			{_props.agentAccountStatusesError ? (
				<div {...stylex.attrs(styles.banner)}>
					<SettingsErrorBanner message={_props.agentAccountStatusesError} />
				</div>
			) : null}
			<SettingsRow label="Provider" description={activeStatusLabel()}>
				<SettingsSegmented label="Default provider">
					{PROVIDERS.map((agentKind) => {
						const status = createMemo(() =>
							_props.agentAccountStatuses.find(
								(item) => item.kind === agentKind,
							),
						);
						return (
							<ProviderChoice
								agentKind={agentKind}
								status={status()}
								connected={status()?.health === "ready"}
								agentAccountStatusesLoading={_props.agentAccountStatusesLoading}
								defaultChatSettings={_props.defaultChatSettings}
								updateDefaultChatSettings={_props.updateDefaultChatSettings}
							/>
						);
					})}
				</SettingsSegmented>
			</SettingsRow>
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
										options: _props.defaultAgentDefinition.reasoningLevels.map(
											(level) => ({ id: level.id, label: level.label }),
										),
									},
								]
							: []),
					] as const
				}
				keyed={(row) => row.key}
			>
				{(field) => (
					<SettingsRow label={field().label}>
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
							buttonClassName={stylex.attrs(styles.control).class}
						/>
					</SettingsRow>
				)}
			</For>
		</SettingsSection>
	);
}
