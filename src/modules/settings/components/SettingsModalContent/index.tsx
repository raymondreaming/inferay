import * as stylex from "@octanejs/stylex";
import { useCallback, useMemo, useState } from "octane";
import type { AgentAccountProviderStatus } from "../../../../../build/presentation/contracts/AgentAccountProviderStatus.ts";
import type { GithubRepo } from "../../../../../build/presentation/contracts/GithubRepo.ts";
import {
	pickCloneDirectory as chooseCloneDirectory,
	fetchJsonOr,
	getAgentDefinition,
	loadDefaultChatSettings,
	saveDefaultChatSettings,
	sendJson,
} from "../../../../adapters/backend/http.ts";
import { useQueryResource } from "../../../../shared/hooks/useQueryResource.tsx";
import type { SettingsModalTarget } from "../../../../shared/lib/data.ts";
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
export function SettingsModalContent({
	section,
}: {
	section: SettingsModalSection;
}) {
	const {
		data: accounts,
		loading: accountsLoading,
		error: accountsError,
		refresh: refreshAccounts,
	} = useForgeAccounts();
	const {
		data: repos,
		loading: reposLoading,
		error: reposError,
		refresh: refreshRepos,
	} = useGithubRepos(accounts.length > 0);
	const {
		data: agentAccountStatuses,
		loading: agentAccountStatusesLoading,
		error: agentAccountStatusesError,
		refresh: refreshAgentAccountStatuses,
	} = useQueryResource(fetchAgentAccountStatuses, [], {
		queryKey: ["agents", "account-status"],
	});
	const [error, setError] = useState<string | null>(null);
	const [connecting, setConnecting] = useState(false);
	const [repoQuery, setRepoQuery] = useState("");
	const [cloneDirectory, setCloneDirectory] = useState("~/Desktop");
	const [cloneStatus, setCloneStatus] = useState<string | null>(null);
	const [cloningRepo, setCloningRepo] = useState<string | null>(null);
	const [defaultChatSettings, setDefaultChatSettings] = useState(() =>
		loadDefaultChatSettings(),
	);
	const defaultAgentDefinition = getAgentDefinition(
		defaultChatSettings.agentKind,
	);
	const defaultModelOptions = defaultAgentDefinition.models.map((option) => ({
		...option,
		icon: getAgentIcon(defaultChatSettings.agentKind, 12),
	}));
	const updateDefaultChatSettings = async (
		next: Partial<typeof defaultChatSettings>,
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
	const loadRepos = useCallback(async () => {
		setError(null);
		invalidateGithubReposCache();
		await refreshRepos();
	}, [refreshRepos, setError]);
	const refreshGithubAccounts = useCallback(async () => {
		invalidateForgeAccountsCache();
		await refreshAccounts();
	}, [refreshAccounts]);
	const githubResourceError = error ?? reposError;
	const filteredRepos = useMemo(() => {
		const query = repoQuery.trim().toLowerCase();
		if (!query) return repos;
		return repos.filter(
			(repo) =>
				repo.full_name.toLowerCase().includes(query) ||
				repo.description?.toLowerCase().includes(query),
		);
	}, [repoQuery, repos]);
	const connectGithub = async () => {
		setConnecting(true);
		try {
			await sendJson("/api/forge/connect", { provider: "github" });
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
			setCloneStatus(await cloneGithubRepo(repo, cloneDirectory));
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
		<div {...stylex.props(styles.settingsLayout)}>
			<main {...stylex.props(styles.modalScroller)}>
				<div {...stylex.props(styles.content)}>
					{section === "all" || section === "agents" ? (
						<ChatDefaultsSettings
							agentAccountStatusesError={agentAccountStatusesError}
							refreshAgentAccountStatuses={refreshAgentAccountStatuses}
							agentAccountStatuses={agentAccountStatuses}
							agentAccountStatusesLoading={agentAccountStatusesLoading}
							defaultChatSettings={defaultChatSettings}
							updateDefaultChatSettings={updateDefaultChatSettings}
							defaultModelOptions={defaultModelOptions}
							defaultAgentDefinition={defaultAgentDefinition}
						/>
					) : null}

					{section === "all" ||
					section === "agents" ||
					section === "appearance" ||
					section === "workspace" ? (
						<div {...stylex.props(styles.settingsCollection)}>
							<SettingsContent showVersion={false} embedded section={section} />
						</div>
					) : null}

					{section === "all" || section === "github" ? (
						<>
							<SettingsSection
								id="github-account"
								title={accounts.length > 1 ? "Accounts" : "Account"}
								description="Your GitHub identity, detected from the GitHub CLI."
								onRefresh={refreshGithubAccounts}
								refreshNoShrink
							>
								{accountsError ? (
									<SettingsErrorBanner message={accountsError} />
								) : null}
								{accountsLoading ? (
									<div {...stylex.props(styles.accountLoadingState)}>
										Checking GitHub CLI account…
									</div>
								) : accounts.length > 0 ? (
									<div {...stylex.props(styles.githubAccountList)}>
										{accounts.map((account) => (
											<SettingsGithubAccount
												key={`${account.host}:${account.login}`}
												account={account}
											/>
										))}
									</div>
								) : (
									<SettingsGithubEmptyState
										onConnect={connectGithub}
										connecting={connecting}
									/>
								)}
							</SettingsSection>

							<SettingsSection
								id="github"
								title="Repositories"
								description="Find repositories from your connected account and clone them locally."
								onRefresh={accounts.length > 0 ? loadRepos : undefined}
								refreshLabel="Repos"
								refreshNoShrink
							>
								{githubResourceError ? (
									<SettingsErrorBanner message={githubResourceError} />
								) : null}
								{cloneStatus ? (
									<SettingsSuccessBanner message={cloneStatus} />
								) : null}

								{accounts.length > 0 ? (
									<>
										<div {...stylex.props(styles.cloneControls)}>
											<TextInput
												type="text"
												value={repoQuery}
												onInput={(event) =>
													setRepoQuery(event.currentTarget.value)
												}
												placeholder="Search repositories"
												fullWidth
												className={stylex.props(styles.flexInput).className}
											/>
											<div {...stylex.props(styles.cloneDirControls)}>
												<TextInput
													type="text"
													value={cloneDirectory}
													onInput={(event) =>
														setCloneDirectory(event.currentTarget.value)
													}
													fullWidth
													className={stylex.props(styles.flexInput).className}
												/>
												<Button
													liquid={false}
													type="button"
													onClick={() => void pickCloneDirectory()}
													variant="ghost"
													size="md"
													className={stylex.props(styles.noShrink).className}
												>
													Browse
												</Button>
											</div>
										</div>
										<div {...stylex.props(styles.repoList)}>
											{reposLoading ? (
												<div {...stylex.props(styles.loadingState)}>
													Loading repositories…
												</div>
											) : filteredRepos.length === 0 ? (
												<div {...stylex.props(styles.loadingState)}>
													No repositories found.
												</div>
											) : (
												filteredRepos.map((repo) => (
													<SettingsRepoRow
														key={repo.full_name}
														repo={repo}
														cloning={cloningRepo === repo.full_name}
														onClone={() => void cloneRepo(repo)}
													/>
												))
											)}
										</div>
									</>
								) : (
									<div {...stylex.props(styles.githubRepoUnavailable)}>
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
