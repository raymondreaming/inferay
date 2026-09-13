import type { AgentAccountProviderStatus, GithubRepo } from "@contracts";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For } from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { useQueryResource } from "../../../../shared/hooks/useQueryResource.tsx";
import type { SettingsModalTarget } from "../../../../shared/lib/dom.tsx";
import {
	pickCloneDirectory as chooseCloneDirectory,
	fetchJson,
	getAgentDefinition,
	loadDefaultChatSettings,
	saveDefaultChatSettings,
	sendJson,
} from "../../../../shared/lib/native.tsx";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import { IconRefreshCw } from "../../../../shared/ui/Icons/index.tsx";
import {
	SettingsEmpty,
	SettingsRow,
	SettingsSection,
	SettingsStack,
} from "../../../../shared/ui/SettingsSurface/index.tsx";
import { TextInput } from "../../../../shared/ui/TextInput/index.tsx";
import { AgentIcon } from "../../../agents/components/AgentIcon/index.tsx";
import {
	invalidateForgeAccountsCache,
	invalidateGithubReposCache,
	useForgeAccounts,
	useGithubRepos,
} from "../../../repository/hooks/useForgeAccounts.tsx";
import { SettingsContent } from "../Settings/index.tsx";
import {
	SettingsGithubAccount,
	SettingsGithubEmptyState,
	SettingsRepoRow,
} from "../SettingsGithub/index.tsx";
import {
	SettingsErrorBanner,
	SettingsSuccessBanner,
} from "../SettingsStatus/index.tsx";
import { ChatDefaultsSettings } from "./ChatDefaultsSettings.tsx";
import { styles } from "./styles.ts";
export type SettingsModalSection = "all" | SettingsModalTarget;
export function SettingsModalContent(_props: {
	section: SettingsModalSection;
}) {
	const showGithub = () =>
		_props.section === "all" || _props.section === "github";
	const _source = useForgeAccounts(showGithub);
	const _source2 = useGithubRepos(
		() => showGithub() && _source.data.length > 0,
	);
	const _source3 = useQueryResource(
		() => fetchAgentAccountStatuses,
		() => [],
		() => ({
			queryKey: ["agents", "account-status"],
			enabled: _props.section === "all" || _props.section === "agents",
		}),
	);
	const [error, setError] = createSignal<string | null>(null);
	const [connecting, setConnecting] = createSignal(false);
	const [repoQuery, setRepoQuery] = createSignal("");
	const [cloneDirectory, setCloneDirectory] = createSignal("~/Desktop");
	const [cloneStatus, setCloneStatus] = createSignal<string | null>(null);
	const [cloningRepo, setCloningRepo] = createSignal<string | null>(null);
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
	const loadRepos = async () => {
		setError(null);
		invalidateGithubReposCache();
		await _source2.refresh();
	};
	const refreshGithubAccounts = async () => {
		invalidateForgeAccountsCache();
		await _source.refresh();
	};
	const githubResourceError = createMemo(() => error() ?? _source2.error);
	const filteredRepos = createMemo(() => {
		const query = repoQuery().trim().toLowerCase();
		if (!query) return _source2.data;
		return _source2.data.filter(
			(repo) =>
				repo.full_name.toLowerCase().includes(query) ||
				repo.description?.toLowerCase().includes(query),
		);
	});
	const connectGithub = async () => {
		setConnecting(true);
		try {
			await sendJson("/api/forge/connect", {
				provider: "github",
			});
		} finally {
			setConnecting(false);
		}
	};
	const pickCloneDirectory = async () => {
		const folder = await chooseCloneDirectory();
		if (folder) setCloneDirectory(folder);
	};
	const cloneRepo = async (repo: GithubRepo) => {
		setCloningRepo(repo.full_name);
		setCloneStatus(null);
		setError(null);
		try {
			setCloneStatus(await cloneGithubRepo(repo, cloneDirectory()));
			invalidateGithubReposCache();
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Unable to clone repository",
			);
		} finally {
			setCloningRepo(null);
		}
	};
	return (
		<SettingsStack>
			{_props.section === "all" || _props.section === "agents" ? (
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

			{_props.section === "all" ||
			_props.section === "agents" ||
			_props.section === "appearance" ||
			_props.section === "workspace" ? (
				<SettingsContent section={_props.section} />
			) : null}

			{_props.section === "all" || _props.section === "github" ? (
				<>
					<SettingsSection
						id="github-account"
						title={_source.data.length > 1 ? "Accounts" : "Account"}
						description="Your GitHub identity, detected from the GitHub CLI."
						action={
							<Button
								liquid={false}
								type="button"
								onClick={() => void refreshGithubAccounts()}
								variant="ghost"
								size="sm"
								class={stylex.attrs(styles.noShrink).class}
							>
								<IconRefreshCw size={iconSize.md} />
								<span>Refresh</span>
							</Button>
						}
					>
						{_source.error ? (
							<div {...stylex.attrs(styles.banner)}>
								<SettingsErrorBanner message={_source.error} />
							</div>
						) : null}
						{_source.loading ? (
							<SettingsEmpty>Checking GitHub CLI account…</SettingsEmpty>
						) : _source.data.length > 0 ? (
							<For
								each={_source.data}
								keyed={(row) => JSON.stringify([row.host, row.login])}
							>
								{(account) => <SettingsGithubAccount account={account()} />}
							</For>
						) : (
							<SettingsGithubEmptyState
								onConnect={connectGithub}
								connecting={connecting()}
							/>
						)}
					</SettingsSection>

					<SettingsSection
						id="github"
						title="Repositories"
						description="Find repositories from your connected account and clone them locally."
						action={
							_source.data.length > 0 ? (
								<Button
									liquid={false}
									type="button"
									onClick={() => void loadRepos()}
									variant="ghost"
									size="sm"
									class={stylex.attrs(styles.noShrink).class}
								>
									<IconRefreshCw size={iconSize.md} />
									<span>Refresh</span>
								</Button>
							) : undefined
						}
					>
						{githubResourceError() ? (
							<div {...stylex.attrs(styles.banner)}>
								<SettingsErrorBanner message={githubResourceError()!} />
							</div>
						) : null}
						{cloneStatus() ? (
							<div {...stylex.attrs(styles.banner)}>
								<SettingsSuccessBanner message={cloneStatus()!} />
							</div>
						) : null}

						{_source.data.length > 0 ? (
							<>
								<SettingsRow label="Find a repository">
									<TextInput
										type="text"
										size="sm"
										value={repoQuery()}
										onChange={(event) =>
											setRepoQuery(event.currentTarget.value)
										}
										placeholder="Search repositories"
										class={stylex.attrs(styles.search).class}
									/>
								</SettingsRow>
								<SettingsRow
									label="Clone into"
									description="Where new clones land on disk."
								>
									<TextInput
										type="text"
										size="sm"
										value={cloneDirectory()}
										onChange={(event) =>
											setCloneDirectory(event.currentTarget.value)
										}
										class={stylex.attrs(styles.cloneDirectory).class}
									/>
									<Button
										liquid={false}
										type="button"
										onClick={() => void pickCloneDirectory()}
										variant="ghost"
										size="sm"
										class={stylex.attrs(styles.noShrink).class}
									>
										Browse
									</Button>
								</SettingsRow>
								<div {...stylex.attrs(styles.repoList)}>
									{_source2.loading ? (
										<SettingsEmpty>Loading repositories…</SettingsEmpty>
									) : filteredRepos().length === 0 ? (
										<SettingsEmpty>No repositories found.</SettingsEmpty>
									) : (
										<For each={filteredRepos()} keyed={(row) => row.full_name}>
											{(repo) => (
												<SettingsRepoRow
													repo={repo()}
													cloning={cloningRepo() === repo().full_name}
													onClone={() => void cloneRepo(repo())}
												/>
											)}
										</For>
									)}
								</div>
							</>
						) : (
							<SettingsEmpty>
								Connect a GitHub account to browse repositories.
							</SettingsEmpty>
						)}
					</SettingsSection>
				</>
			) : null}
		</SettingsStack>
	);
}
export async function fetchAgentAccountStatuses(signal?: AbortSignal) {
	const payload = await fetchJson<{
		providers?: AgentAccountProviderStatus[];
	}>("/api/agents/account-status", { signal });
	return Array.isArray(payload.providers) ? payload.providers : [];
}
export async function cloneGithubRepo(
	repo: GithubRepo,
	cloneDirectory: string,
) {
	const response = await sendJson("/api/forge/clone", {
		gitUrl: repo.html_url,
		cloneDirectory,
	});
	const payload = (await response.json()) as {
		error?: string;
		displayPath?: string;
	};
	if (!response.ok) throw new Error(payload.error ?? "Clone failed");
	return `Cloned ${repo.full_name} to ${payload.displayPath}`;
}
