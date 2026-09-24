import { AgentIcon } from "@agents/components/AgentIcon/index.tsx";
import type {
	AppFontId,
	ProviderSettings,
	ProviderSettingsView,
} from "@contracts";
import { iconSize } from "@design-system/styles.stylex.ts";
import {
	APP_FONTS,
	applyAppFont,
	loadAppFontId,
	saveAppFontId,
} from "@settings/hooks/useAppAppearance.tsx";
import { useQueryResource } from "@shared/hooks/useQueryResource.tsx";
import {
	SYNTAX_HIGHLIGHT_THEMES,
	type SyntaxHighlightTheme,
	useSyntaxHighlightTheme,
} from "@shared/hooks/useSyntaxHighlight.tsx";
import type { SettingsModalTarget } from "@shared/lib/dom.tsx";
import {
	loadDefaultChatSettings,
	project,
	saveDefaultChatSettings,
} from "@shared/lib/native.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { DropdownButton } from "@shared/ui/DropdownButton/index.tsx";
import { ErrorBoundary } from "@shared/ui/ErrorBoundary/index.tsx";
import { IconRefreshCw } from "@shared/ui/Icons/index.tsx";
import {
	SettingsRow,
	SettingsSection,
	SettingsSegment,
	SettingsSegmented,
	SettingsStack,
} from "@shared/ui/SettingsSurface/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, Loading } from "solid-js";
import { fetchAgentAccountStatuses } from "../../services/settingsApi.ts";
import {
	BackgroundScenePicker,
	InstructionsEditor,
	SearchFoldersSection,
} from "../Settings/index.tsx";
import { SettingsErrorBanner } from "../SettingsStatus/index.tsx";
import { GithubSettings } from "./GithubSettings.tsx";
import { McpSettings } from "./McpSettings.tsx";
import { styles } from "./styles.ts";

type SettingsModalSection = "all" | SettingsModalTarget;

/** Native models own choices and defaults; this component owns form/query lifecycles. */
export function SettingsModalContent(props: { section: SettingsModalSection }) {
	const show = (section: SettingsModalTarget) =>
		props.section === "all" || props.section === section;
	const accounts = useQueryResource(
		() => fetchAgentAccountStatuses,
		() => [],
		() => ({ queryKey: ["agents", "account-status"], enabled: show("agents") }),
	);
	const [error, setError] = createSignal<string | null>(null);
	const [defaults, setDefaults] = createSignal(loadDefaultChatSettings);
	const view = createMemo(() =>
		project<ProviderSettingsView>("providerSettings", {
			settings: defaults(),
			statuses: accounts.data,
			loading: accounts.loading,
		}),
	);
	const [syntaxTheme, setSyntaxTheme] = useSyntaxHighlightTheme();
	const [appFontId, setAppFontId] = createSignal<AppFontId>(loadAppFontId);
	const ModelIcon = () => <AgentIcon kind={defaults().agentKind} size={12} />;
	const updateDefaults = async (next: Partial<ProviderSettings>) => {
		try {
			setDefaults(
				await saveDefaultChatSettings({
					...loadDefaultChatSettings(),
					...next,
				}),
			);
			setError(null);
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error));
		}
	};
	return (
		<SettingsStack>
			{show("mcp") && <McpSettings />}
			{show("agents") && (
				<>
					<SettingsSection
						id="agent-defaults"
						title="New chats"
						description="The provider, model, and reasoning level used by default."
						action={
							<Button
								type="button"
								onClick={accounts.refresh}
								variant="ghost"
								size="sm"
								class={stylex.attrs(styles.noShrink).class}
							>
								<IconRefreshCw size={iconSize.md} />
								<span>Refresh</span>
							</Button>
						}
					>
						{(error() ?? accounts.error) && (
							<div {...stylex.attrs(styles.banner)}>
								<SettingsErrorBanner message={(error() ?? accounts.error)!} />
							</div>
						)}
						<SettingsRow label="Provider" description={view().statusLabel}>
							<SettingsSegmented label="Default provider">
								<For
									each={view().providers}
									keyed={(provider) => provider.kind}
								>
									{(provider) => (
										<SettingsSegment
											selected={provider().selected}
											disabled={provider().disabled}
											title={provider().title}
											icon={<AgentIcon kind={provider().kind} size={12} />}
											onSelect={() =>
												void updateDefaults({
													agentKind: provider().kind,
													model: provider().model,
												})
											}
										>
											{provider().label}
										</SettingsSegment>
									)}
								</For>
							</SettingsSegmented>
						</SettingsRow>
						<For each={view().fields} keyed={(field) => field.key}>
							{(field) => (
								<SettingsRow label={field().label}>
									<DropdownButton
										value={field().value}
										options={field().options.map((option) => ({
											...option,
											iconComponent:
												field().key === "model" ? ModelIcon : undefined,
										}))}
										onChange={(value) =>
											void updateDefaults({ [field().key]: value })
										}
										buttonClassName={stylex.attrs(styles.control).class}
									/>
								</SettingsRow>
							)}
						</For>
					</SettingsSection>
					<SettingsSection
						id="agent-instructions"
						title="Global agent instructions"
						description="Your default AGENTS.md. Every new chat inherits these instructions."
					>
						<ErrorBoundary label="Agent instructions" contained>
							<Loading
								fallback={<p role="status">Loading agent instructions…</p>}
							>
								<InstructionsEditor />
							</Loading>
						</ErrorBoundary>
					</SettingsSection>
				</>
			)}
			{show("workspace") && <SearchFoldersSection />}
			{show("appearance") && (
				<>
					<BackgroundScenePicker />
					<SettingsSection
						id="typography"
						title="Text and code"
						description="How Inferay renders interface text, diffs, and source."
					>
						<SettingsRow
							label="Interface font"
							description="System interface text with Menlo for code and diffs."
						>
							<DropdownButton
								value={appFontId()}
								options={APP_FONTS}
								onChange={(id) => {
									const next = id as AppFontId;
									setAppFontId(next);
									saveAppFontId(next);
									applyAppFont(next);
								}}
								buttonClassName={stylex.attrs(styles.control).class}
							/>
						</SettingsRow>
						<SettingsRow
							label="Code theme"
							description="Syntax colors for full files and inline diffs."
						>
							<DropdownButton
								value={syntaxTheme()}
								options={SYNTAX_HIGHLIGHT_THEMES}
								onChange={(id) => setSyntaxTheme(id as SyntaxHighlightTheme)}
								placeholder="Syntax theme"
								buttonClassName={stylex.attrs(styles.control).class}
							/>
						</SettingsRow>
					</SettingsSection>
				</>
			)}
			{show("github") && <GithubSettings />}
		</SettingsStack>
	);
}
