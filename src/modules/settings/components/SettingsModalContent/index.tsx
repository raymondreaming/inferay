import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For } from "solid-js";
import type { AgentAccountProviderStatus } from "../../../../../build/presentation/contracts/AgentAccountProviderStatus.ts";
import type { GithubRepo } from "../../../../../build/presentation/contracts/GithubRepo.ts";
import { useQueryResource } from "../../../../shared/hooks/useQueryResource.tsx";
import type { SettingsModalTarget } from "../../../../shared/lib/dom.tsx";
import {
	pickCloneDirectory as chooseCloneDirectory,
	fetchJsonOr,
	getAgentDefinition,
	loadDefaultChatSettings,
	saveDefaultChatSettings,
	sendJson,
} from "../../../../shared/lib/native.tsx";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import { TextInput } from "../../../../shared/ui/TextInput/index.tsx";
import { getAgentIcon } from "../../../agents/components/AgentIcon/index.tsx";
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
import { SettingsSection } from "./SettingsSection.tsx";
import { styles } from "./styles.ts";
export type SettingsModalSection = "all" | SettingsModalTarget;
export function SettingsModalContent(_props: {
	section: SettingsModalSection;
}) {
	const _source = useForgeAccounts();
	const _source2 = useGithubRepos(() => _source.data.length > 0);
	const _source3 = useQueryResource(
		() => fetchAgentAccountStatuses,
		() => [],
		() => ({
			queryKey: ["agents", "account-status"],
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
	const defaultModelOptions = createMemo(() =>
		defaultAgentDefinition().models.map((option) => ({
			...option,
			icon: getAgentIcon(defaultChatSettings().agentKind, 12),
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
		<div {...stylex.attrs(styles.settingsLayout)}>
			<main {...stylex.attrs(styles.modalScroller)}>
				<div {...stylex.attrs(styles.content)}>
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
						<div {...stylex.attrs(styles.settingsCollection)}>
							<SettingsContent
								showVersion={false}
								embedded
								section={_props.section}
							/>
						</div>
					) : null}

					{_props.section === "all" || _props.section === "github" ? (
						<>
							<SettingsSection
								id="github-account"
								title={_source.data.length > 1 ? "Accounts" : "Account"}
								description="Your GitHub identity, detected from the GitHub CLI."
								onRefresh={refreshGithubAccounts}
								refreshNoShrink
							>
								{_source.error ? (
									<SettingsErrorBanner message={_source.error} />
								) : null}
								{_source.loading ? (
									<div {...stylex.attrs(styles.accountLoadingState)}>
										Checking GitHub CLI account…
									</div>
								) : _source.data.length > 0 ? (
									<div {...stylex.attrs(styles.githubAccountList)}>
										{
											<For
												each={_source.data}
												keyed={(row) => JSON.stringify([row.host, row.login])}
											>
												{(account) => (
													<SettingsGithubAccount account={account()} />
												)}
											</For>
										}
									</div>
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
								onRefresh={_source.data.length > 0 ? loadRepos : undefined}
								refreshLabel="Repos"
								refreshNoShrink
							>
								{githubResourceError() ? (
									<SettingsErrorBanner message={githubResourceError()!} />
								) : null}
								{cloneStatus() ? (
									<SettingsSuccessBanner message={cloneStatus()!} />
								) : null}

								{_source.data.length > 0 ? (
									<>
										<div {...stylex.attrs(styles.cloneControls)}>
											<TextInput
												type="text"
												value={repoQuery()}
												onChange={(event) =>
													setRepoQuery(event.currentTarget.value)
												}
												placeholder="Search repositories"
												fullWidth
												class={stylex.attrs(styles.flexInput).class}
											/>
											<div {...stylex.attrs(styles.cloneDirControls)}>
												<TextInput
													type="text"
													value={cloneDirectory()}
													onChange={(event) =>
														setCloneDirectory(event.currentTarget.value)
													}
													fullWidth
													class={stylex.attrs(styles.flexInput).class}
												/>
												<Button
													liquid={false}
													type="button"
													onClick={() => void pickCloneDirectory()}
													variant="ghost"
													size="md"
													class={stylex.attrs(styles.noShrink).class}
												>
													Browse
												</Button>
											</div>
										</div>
										<div {...stylex.attrs(styles.repoList)}>
											{_source2.loading ? (
												<div {...stylex.attrs(styles.loadingState)}>
													Loading repositories…
												</div>
											) : filteredRepos().length === 0 ? (
												<div {...stylex.attrs(styles.loadingState)}>
													No repositories found.
												</div>
											) : (
												<For
													each={filteredRepos()}
													keyed={(row) => row.full_name}
												>
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
									<div {...stylex.attrs(styles.githubRepoUnavailable)}>
										Connect a GitHub account to browse repositories.
									</div>
								)}
							</SettingsSection>
						</>
					) : null}
				</div>
			</main>
		</div>
	);
}
export async function fetchAgentAccountStatuses() {
	const payload = await fetchJsonOr<{
		providers?: AgentAccountProviderStatus[];
	}>("/api/agents/account-status", {});
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
