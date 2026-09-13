import { AgentIcon } from "@agents/components/AgentIcon/index.tsx";
import { useQueryResource } from "@shared/hooks/useQueryResource.tsx";
import type { SettingsModalTarget } from "@shared/lib/dom.tsx";
import {
	getAgentDefinition,
	loadDefaultChatSettings,
	saveDefaultChatSettings,
} from "@shared/lib/native.tsx";
import { SettingsStack } from "@shared/ui/SettingsSurface/index.tsx";
import { createMemo, createSignal } from "solid-js";
import { fetchAgentAccountStatuses } from "../../services/settingsApi.ts";
import { SettingsContent } from "../Settings/index.tsx";
import { ChatDefaultsSettings } from "./ChatDefaultsSettings.tsx";
import { GithubSettings } from "./GithubSettings.tsx";
export type SettingsModalSection = "all" | SettingsModalTarget;
export function SettingsModalContent(props: { section: SettingsModalSection }) {
	const showGithub = () =>
		props.section === "all" || props.section === "github";
	const _source3 = useQueryResource(
		() => fetchAgentAccountStatuses,
		() => [],
		() => ({
			queryKey: ["agents", "account-status"],
			enabled: props.section === "all" || props.section === "agents",
		}),
	);
	const [error, setError] = createSignal<string | null>(null);
	const [defaultChatSettings, setDefaultChatSettings] = createSignal(
		(() => loadDefaultChatSettings())(),
	);
	const defaultAgentDefinition = createMemo(() =>
		getAgentDefinition(defaultChatSettings().agentKind),
	);
	const ModelIcon = () => (
		<AgentIcon kind={defaultChatSettings().agentKind} size={12} />
	);
	const defaultModelOptions = createMemo(() =>
		defaultAgentDefinition().models.map((option) => ({
			id: option.id,
			label: option.label,
			iconComponent: ModelIcon,
		})),
	);
	const updateDefaultChatSettings = async (
		next: Partial<ReturnType<typeof defaultChatSettings>>,
	) => {
		try {
			const normalized = await saveDefaultChatSettings({
				...loadDefaultChatSettings(),
				...next,
			});
			setDefaultChatSettings(normalized);
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error));
		}
	};
	return (
		<SettingsStack>
			{props.section === "all" || props.section === "agents" ? (
				<ChatDefaultsSettings
					agentAccountStatusesError={_source3.error}
					refreshAgentAccountStatuses={_source3.refresh}
					agentAccountStatuses={_source3.data}
					agentAccountStatusesLoading={_source3.loading}
					defaultChatSettings={defaultChatSettings()}
					updateDefaultChatSettings={updateDefaultChatSettings}
					defaultModelOptions={defaultModelOptions()}
					defaultAgentDefinition={defaultAgentDefinition()}
				/>
			) : null}

			{props.section === "all" ||
			props.section === "agents" ||
			props.section === "appearance" ||
			props.section === "workspace" ? (
				<SettingsContent section={props.section} />
			) : null}

			{showGithub() ? <GithubSettings externalError={error()} /> : null}
		</SettingsStack>
	);
}
