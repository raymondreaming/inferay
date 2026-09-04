import * as stylex from "@octanejs/stylex";
import { useCallback, useMemo, useReducer, useState } from "octane";
import {
	fetchJsonOr,
	sendJsonWithBusy,
} from "../../../adapters/backend/http.ts";
import {
	breakpoint,
	color,
	controlSize,
	font,
	iconSize,
	radius,
} from "../../../design-system/styles.stylex.ts";
import { getAgentIcon } from "../../../modules/agents/components/AgentIcon.tsx";
import type { AgentAccountProviderStatus } from "../../../modules/agents/model/agent-account-status.ts";
import {
	CODEX_REASONING_LEVELS,
	getAgentDefinition,
	loadDefaultChatSettings,
	saveDefaultChatSettings,
} from "../../../modules/agents/model/agents.ts";
import {
	fetchForgeAccounts,
	fetchGithubRepos,
	getCachedForgeAccounts,
	getCachedGithubRepos,
	invalidateForgeAccountsCache,
	invalidateGithubReposCache,
} from "../../../modules/repository/adapters/forge-client.ts";
import type { GithubRepo } from "../../../modules/repository/adapters/types.ts";
import {
	areForgeAccountsEqual,
	areGithubReposEqual,
} from "../../../modules/repository/model/forge-equality.ts";
import { SettingsContent } from "../../../modules/settings/index.ts";
import { dispatchAgentShellChange } from "../../../modules/workspace/model/workspace-model.ts";
import { useQueryResource } from "../../../shared/hooks/useQueryResource.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { DropdownButton } from "../../../shared/ui/DropdownButton.tsx";
import { IconRefreshCw } from "../../../shared/ui/Icons.tsx";
import { TextInput } from "../../../shared/ui/TextInput.tsx";
import type { SettingsModalTarget } from "../model/settings-events.ts";
import {
	areAgentAccountStatusesEqual,
	initialSettingsModalUiState,
	type LoadState,
	type SettingsModalUiAction,
	type SettingsModalUiState,
	type StateValue,
	settingsModalUiReducer,
} from "../model/settings-modal-state.ts";
import {
	SettingsGithubAccount,
	SettingsGithubEmptyState,
	SettingsRepoRow,
} from "./SettingsGithub.tsx";
import {
	SettingsErrorBanner,
	SettingsSuccessBanner,
} from "./SettingsStatus.tsx";

function SettingsSection({
	id,
	title,
	description,
	actions,
	children,
}: {
	id: string;
	title: string;
	description: string;
	actions?: unknown;
	children: unknown;
}) {
	return (
		<section id={id} {...stylex.props(styles.settingsSection)}>
			<div {...stylex.props(styles.sectionIntro)}>
				<div {...stylex.props(styles.sectionIntroText)}>
					<h2 {...stylex.props(styles.sectionTitle)}>{title}</h2>
					<p {...stylex.props(styles.sectionDescription)}>{description}</p>
				</div>
				{actions ? (
					<div {...stylex.props(styles.sectionActions)}>{actions}</div>
				) : null}
			</div>
			{children}
		</section>
	);
}

export type SettingsModalSection = "all" | SettingsModalTarget;

export function SettingsModalContent({
	section,
}: {
	section: SettingsModalSection;
}) {
	const initialAccounts = getCachedForgeAccounts();
	const {
		data: accounts,
		loading: accountsLoading,
		error: accountsError,
		refresh: refreshAccounts,
	} = useQueryResource(() => fetchForgeAccounts(), initialAccounts, {
		queryKey: ["forge", "accounts"],
		isEqual: areForgeAccountsEqual,
	});
	const loadState: LoadState = accountsLoading
		? "loading"
		: accountsError
			? "error"
			: accounts.length > 0
				? "ready"
				: "idle";
	const fetchRepos = useCallback(
		async () => (accounts.length > 0 ? fetchGithubRepos() : []),
		[accounts.length],
	);
	const {
		data: repos,
		loading: reposLoading,
		error: reposError,
		refresh: refreshRepos,
	} = useQueryResource(fetchRepos, getCachedGithubRepos(), {
		queryKey: ["forge", "repos"],
		isEqual: areGithubReposEqual,
	});
	const fetchAgentAccountStatuses = useCallback(
		async () =>
			fetchJsonOr<{ providers?: AgentAccountProviderStatus[] }>(
				"/api/agents/account-status",
				{},
			).then((payload) =>
				Array.isArray(payload.providers) ? payload.providers : [],
			),
		[],
	);
	const {
		data: agentAccountStatuses,
		loading: agentAccountStatusesLoading,
		error: agentAccountStatusesError,
		refresh: refreshAgentAccountStatuses,
	} = useQueryResource(fetchAgentAccountStatuses, [], {
		queryKey: ["agents", "account-status"],
		isEqual: areAgentAccountStatusesEqual,
	});
	const [settingsModalUiState, settingsModalUiDispatch] = useReducer(
		settingsModalUiReducer,
		initialSettingsModalUiState,
	);
	const {
		error,
		connecting,
		repoQuery,
		cloneDirectory,
		cloneStatus,
		cloningRepo,
	} = settingsModalUiState;
	const setSettingsModalUiField = useCallback(
		<K extends keyof SettingsModalUiState>(
			field: K,
			value: StateValue<SettingsModalUiState[K]>,
		) =>
			settingsModalUiDispatch({
				type: "fieldChanged",
				field,
				value,
			} as SettingsModalUiAction),
		[],
	);
	const setError = useCallback(
		(value: StateValue<string | null>) =>
			setSettingsModalUiField("error", value),
		[setSettingsModalUiField],
	);
	const setConnecting = useCallback(
		(value: StateValue<boolean>) =>
			setSettingsModalUiField("connecting", value),
		[setSettingsModalUiField],
	);
	const setRepoQuery = useCallback(
		(value: StateValue<string>) => setSettingsModalUiField("repoQuery", value),
		[setSettingsModalUiField],
	);
	const setCloneDirectory = useCallback(
		(value: StateValue<string>) =>
			setSettingsModalUiField("cloneDirectory", value),
		[setSettingsModalUiField],
	);
	const setCloneStatus = useCallback(
		(value: StateValue<string | null>) =>
			setSettingsModalUiField("cloneStatus", value),
		[setSettingsModalUiField],
	);
	const setCloningRepo = useCallback(
		(value: StateValue<string | null>) =>
			setSettingsModalUiField("cloningRepo", value),
		[setSettingsModalUiField],
	);
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

	const updateDefaultChatSettings = (
		next: Partial<typeof defaultChatSettings>,
	) => {
		const merged = loadDefaultChatSettings();
		const settings = { ...merged, ...next };
		const normalized = {
			...settings,
			model: getAgentDefinition(settings.agentKind).models.some(
				(option) => option.id === settings.model,
			)
				? settings.model
				: getAgentDefinition(settings.agentKind).defaultModel,
		};
		saveDefaultChatSettings(normalized);
		setDefaultChatSettings(loadDefaultChatSettings());
	};
	const loadRepos = useCallback(
		async (force = false) => {
			setError(null);
			if (force) invalidateGithubReposCache();
			await refreshRepos();
		},
		[refreshRepos, setError],
	);
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

	const connectGithub = sendJsonWithBusy.bind(
		null,
		setConnecting,
		"/api/forge/connect",
		{ provider: "github" },
		undefined,
	);

	const pickCloneDirectory = async () => {
		const payload = await fetchJsonOr<{ folder: string | null }>(
			"/api/config/pick-folder",
			{ folder: null },
			{ method: "POST" },
		);
		if (payload.folder) setCloneDirectory(payload.folder);
	};

	const cloneRepo = async (repo: GithubRepo) => {
		setCloningRepo(repo.full_name);
		setCloneStatus(null);
		setError(null);
		try {
			const response = await fetch("/api/forge/clone", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					gitUrl: repo.html_url,
					cloneDirectory,
				}),
			});
			const payload = (await response.json()) as {
				error?: string;
				displayPath?: string;
			};
			if (!response.ok) throw new Error(payload.error ?? "Clone failed");
			invalidateGithubReposCache();
			setCloneStatus(`Cloned ${repo.full_name} to ${payload.displayPath}`);
			dispatchAgentShellChange({ source: "cache", reason: "repo-cloned" });
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
						<SettingsSection
							id="agent-defaults"
							title="New chats"
							description="The provider, model, and reasoning level used by default."
							actions={
								<Button
									liquid={false}
									type="button"
									onClick={() => void refreshAgentAccountStatuses()}
									variant="secondary"
									size="sm"
								>
									<IconRefreshCw size={iconSize.md} />
									<span>Refresh</span>
								</Button>
							}
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
												<button
													key={agentKind}
													type="button"
													onClick={() =>
														updateDefaultChatSettings({
															agentKind,
															model: getAgentDefinition(agentKind).defaultModel,
														})
													}
													disabled={
														status ? !connected : agentAccountStatusesLoading
													}
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
														<strong>
															{getAgentDefinition(agentKind).label}
														</strong>
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
														<span {...stylex.props(styles.agentDefaultLabel)}>
															Default
														</span>
													) : null}
												</button>
											);
										})}
									</div>
								</div>
								<div {...stylex.props(styles.defaultSettingsGrid)}>
									<div {...stylex.props(styles.settingField)}>
										<span {...stylex.props(styles.settingLabel)}>Model</span>
										<DropdownButton
											liquid={false}
											value={defaultChatSettings.model}
											options={defaultModelOptions}
											onChange={(model) => updateDefaultChatSettings({ model })}
											fullWidth
											buttonClassName={
												stylex.props(styles.settingsDropdown).className
											}
										/>
									</div>
									{defaultChatSettings.agentKind === "codex" ? (
										<div {...stylex.props(styles.settingField)}>
											<span {...stylex.props(styles.settingLabel)}>
												Reasoning
											</span>
											<DropdownButton
												liquid={false}
												value={defaultChatSettings.reasoningLevel}
												options={CODEX_REASONING_LEVELS.map((level) => ({
													id: level.id,
													label: level.label,
													detail: level.detail,
												}))}
												onChange={(reasoningLevel) =>
													updateDefaultChatSettings({ reasoningLevel })
												}
												fullWidth
												buttonClassName={
													stylex.props(styles.settingsDropdown).className
												}
											/>
										</div>
									) : null}
								</div>
							</div>
						</SettingsSection>
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
								actions={
									<Button
										liquid={false}
										type="button"
										onClick={() => void refreshGithubAccounts()}
										variant="secondary"
										size="sm"
										className={stylex.props(styles.noShrink).className}
									>
										<IconRefreshCw size={iconSize.md} />
										<span>Refresh</span>
									</Button>
								}
							>
								{accountsError ? (
									<SettingsErrorBanner message={accountsError} />
								) : null}
								{loadState === "loading" ? (
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
								actions={
									accounts.length > 0 ? (
										<Button
											liquid={false}
											type="button"
											onClick={() => void loadRepos(true)}
											variant="secondary"
											size="sm"
											className={stylex.props(styles.noShrink).className}
										>
											<IconRefreshCw size={iconSize.md} />
											<span>Repos</span>
										</Button>
									) : null
								}
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

const styles = stylex.create({
	settingsLayout: {
		display: "block",
		minWidth: controlSize._0,
	},
	modalScroller: {
		minWidth: controlSize._0,
		overflow: "visible",
	},
	settingsSection: {
		backgroundColor: color.surfaceWhite025,
		borderColor: color.border,
		borderRadius: radius.xl,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._4,
		padding: controlSize._4,
		scrollMarginTop: controlSize._5,
	},
	settingsCollection: {
		display: "block",
	},
	sectionIntro: {
		alignItems: {
			default: "flex-start",
			[breakpoint.tablet]: "center",
		},
		display: "flex",
		gap: controlSize._4,
		justifyContent: "space-between",
	},
	sectionIntroText: {
		minWidth: controlSize._0,
	},
	sectionTitle: {
		color: color.textMain,
		fontSize: font.size_5,
		fontWeight: font.weight_6,
		letterSpacing: "-0.006em",
		margin: controlSize._0,
	},
	sectionDescription: {
		color: color.textMuted,
		fontSize: font.size_2,
		lineHeight: 1.4,
		marginBlockEnd: controlSize._0,
		marginBlockStart: controlSize._1,
		maxWidth: "38rem",
	},
	sectionActions: {
		alignItems: "center",
		display: "flex",
		flexShrink: 0,
		gap: controlSize._2,
	},
	defaultSettingsGrid: {
		display: "grid",
		gridTemplateColumns: {
			default: "1fr",
			[breakpoint.standard]: "repeat(2, minmax(0, 1fr))",
		},
		gap: controlSize._2,
	},
	agentDefaultsControl: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._4,
	},
	agentProviderGrid: {
		display: "grid",
		gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
		gap: controlSize._2,
	},
	agentProviderChoice: {
		alignItems: "center",
		display: "flex",
		backgroundColor: {
			default: color.surfaceWhite025,
			":hover": color.surfaceWhite06,
		},
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		fontSize: font.size_2,
		gap: controlSize._2,
		minHeight: controlSize._12,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
		textAlign: "left",
		":disabled": {
			opacity: 0.45,
		},
	},
	agentProviderChoiceActive: {
		backgroundColor: color.surfaceWhite075,
		borderColor: color.borderStrong,
		color: color.textMain,
	},
	agentProviderIcon: {
		alignItems: "center",
		display: "inline-flex",
		flexShrink: 0,
		justifyContent: "center",
	},
	agentProviderText: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		gap: controlSize._0_5,
		minWidth: controlSize._0,
	},
	agentProviderStatus: {
		color: color.textMuted,
		fontSize: font.size_1,
	},
	agentDefaultLabel: {
		color: color.textMuted,
		flexShrink: 0,
		fontSize: font.size_1,
	},
	settingField: {
		display: "flex",
		minWidth: controlSize._0,
		flexDirection: "column",
		gap: controlSize._1,
	},
	settingLabel: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
	},
	settingsDropdown: {
		backgroundColor: color.surfaceWhite025,
		backgroundImage: "none",
		borderColor: color.border,
		borderRadius: radius.lg,
		boxShadow: "none",
		fontSize: font.size_2,
		height: controlSize._8,
	},
	noShrink: {
		flexShrink: 0,
	},
	flexInput: {
		backgroundColor: color.surfaceWhite025,
		borderRadius: radius.lg,
		flex: 1,
	},
	content: {
		boxSizing: "border-box",
		display: "flex",
		flexDirection: "column",
		gap: controlSize._3,
		marginInline: "auto",
		maxWidth: "46rem",
		paddingBlock: controlSize._5,
		paddingInline: controlSize._6,
		width: "100%",
	},
	cloneControls: {
		display: "flex",
		flexDirection: {
			default: "column",
			[breakpoint.tabletWide]: "row",
		},
		gap: controlSize._2,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		paddingBlock: controlSize._3,
	},
	cloneDirControls: {
		display: "flex",
		minWidth: controlSize._0,
		alignItems: "center",
		gap: controlSize._2,
		width: {
			default: "auto",
			[breakpoint.tabletWide]: "320px",
		},
	},
	repoList: {
		maxHeight: "320px",
		overflowY: "auto",
	},
	loadingState: {
		display: "flex",
		height: "6rem",
		alignItems: "center",
		justifyContent: "center",
		color: color.textMuted,
		fontSize: font.size_2,
	},
	accountLoadingState: {
		display: "flex",
		height: "7rem",
		alignItems: "center",
		justifyContent: "center",
		color: color.textMuted,
		fontSize: font.size_2,
	},
	githubAccountList: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
	},
	githubRepoUnavailable: {
		alignItems: "center",
		color: color.textMuted,
		display: "flex",
		fontSize: font.size_2,
		height: "5rem",
		justifyContent: "center",
	},
});
