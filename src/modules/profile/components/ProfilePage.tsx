import * as stylex from "@octanejs/stylex";
import { useNavigate } from "@octanejs/tanstack-router";
import { useCallback, useMemo, useReducer, useRef, useState } from "octane";
import {
	fetchJsonOr,
	sendJsonWithBusy,
} from "../../../adapters/backend/http.ts";
import { ONBOARDING_DONE_STORAGE_KEY } from "../../../adapters/storage/keys.ts";
import { removeStoredValue } from "../../../adapters/storage/stored-values.ts";
import { iconSize } from "../../../design-system.ts";
import { getAgentIcon } from "../../../modules/agents/components/AgentIcon.tsx";
import type { AgentAccountProviderStatus } from "../../../modules/agents/model/agent-account-status.ts";
import {
	CODEX_REASONING_LEVELS,
	getAgentDefinition,
	loadDefaultChatSettings,
	saveDefaultChatSettings,
} from "../../../modules/agents/model/agents.ts";
import {
	ProfileGithubEmptyState,
	ProfileRepoRow,
} from "../../../modules/profile/components/ProfileGithub.tsx";
import {
	ProfileAccountAvatar,
	ProfileErrorBanner,
	ProfileSuccessBanner,
} from "../../../modules/profile/components/ProfileStatus.tsx";
import {
	fetchForgeAccounts,
	fetchGithubRepos,
	getCachedForgeAccounts,
	getCachedGithubRepos,
	invalidateGithubReposCache,
} from "../../../modules/repository/adapters/forge-client.ts";
import type { GithubRepo } from "../../../modules/repository/adapters/types.ts";
import {
	areForgeAccountsEqual,
	areGithubReposEqual,
} from "../../../modules/repository/model/forge-equality.ts";
import { SettingsContent } from "../../../modules/settings/index.ts";
import { dispatchAgentShellChange } from "../../../modules/workspace/model/workspace-model.ts";
import { useAppInfo } from "../../../shared/hooks/useAppInfo.ts";
import { useQueryResource } from "../../../shared/hooks/useQueryResource.tsx";
import { isActive } from "../../../shared/lib/data.ts";
import { Button } from "../../../shared/ui/Button.tsx";
import { DropdownButton } from "../../../shared/ui/DropdownButton.tsx";
import {
	IconAgent,
	IconGitBranch,
	IconLayoutGrid,
	IconRefreshCw,
	IconRobot,
	IconSettings,
	IconUser,
} from "../../../shared/ui/Icons.tsx";
import { TextInput } from "../../../shared/ui/TextInput.tsx";
import {
	WorkspaceContent,
	WorkspacePage,
} from "../../../shared/ui/WorkspacePage.tsx";
import {
	breakpoint,
	color,
	controlSize,
	font,
	motion,
	radius,
} from "../../../tokens.stylex.ts";
import {
	areAgentAccountStatusesEqual,
	initialProfileUiState,
	type LoadState,
	type ProfileUiAction,
	type ProfileUiState,
	profileUiReducer,
	type StateValue,
} from "../model/profile-state.ts";

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

export function ProfilePage() {
	const navigate = useNavigate();
	const resetOnboarding = () => {
		removeStoredValue(ONBOARDING_DONE_STORAGE_KEY);
		navigate({ to: "/onboarding", replace: true });
	};
	const initialAccounts = getCachedForgeAccounts();
	const {
		data: accounts,
		loading: accountsLoading,
		error: accountsError,
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
	const [profileUiState, profileUiDispatch] = useReducer(
		profileUiReducer,
		initialProfileUiState,
	);
	const {
		error,
		connecting,
		repoQuery,
		cloneDirectory,
		cloneStatus,
		cloningRepo,
	} = profileUiState;
	const setProfileUiField = useCallback(
		<K extends keyof ProfileUiState>(
			field: K,
			value: StateValue<ProfileUiState[K]>,
		) =>
			profileUiDispatch({
				type: "fieldChanged",
				field,
				value,
			} as ProfileUiAction),
		[],
	);
	const setError = useCallback(
		(value: StateValue<string | null>) => setProfileUiField("error", value),
		[setProfileUiField],
	);
	const setConnecting = useCallback(
		(value: StateValue<boolean>) => setProfileUiField("connecting", value),
		[setProfileUiField],
	);
	const setRepoQuery = useCallback(
		(value: StateValue<string>) => setProfileUiField("repoQuery", value),
		[setProfileUiField],
	);
	const setCloneDirectory = useCallback(
		(value: StateValue<string>) => setProfileUiField("cloneDirectory", value),
		[setProfileUiField],
	);
	const setCloneStatus = useCallback(
		(value: StateValue<string | null>) =>
			setProfileUiField("cloneStatus", value),
		[setProfileUiField],
	);
	const setCloningRepo = useCallback(
		(value: StateValue<string | null>) =>
			setProfileUiField("cloningRepo", value),
		[setProfileUiField],
	);
	const [defaultChatSettings, setDefaultChatSettings] = useState(() =>
		loadDefaultChatSettings(),
	);
	const [activeSettingsSection, setActiveSettingsSection] = useState("account");
	const settingsScrollRef = useRef<HTMLElement | null>(null);
	const { data: appInfo } = useAppInfo();
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
	const scrollToSettingsSection = useCallback((id: string) => {
		setActiveSettingsSection(id);
		const scroller = settingsScrollRef.current;
		const section = document.getElementById(id);
		if (!scroller || !section) return;
		const scrollerTop = scroller.getBoundingClientRect().top;
		const sectionTop = section.getBoundingClientRect().top;
		scroller.scrollTo({
			top: scroller.scrollTop + sectionTop - scrollerTop,
			behavior: "smooth",
		});
	}, []);

	const loadRepos = useCallback(
		async (force = false) => {
			setError(null);
			if (force) invalidateGithubReposCache();
			await refreshRepos();
		},
		[refreshRepos, setError],
	);

	const resourceError =
		error ?? accountsError ?? reposError ?? agentAccountStatusesError;

	const activeAccount = useMemo(
		() => accounts.find(isActive) ?? accounts[0] ?? null,
		[accounts],
	);

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
		<WorkspacePage>
			<div {...stylex.props(styles.settingsLayout)}>
				<aside {...stylex.props(styles.settingsNav)}>
					<div {...stylex.props(styles.settingsNavHeader)}>
						<span {...stylex.props(styles.settingsNavEyebrow)}>Inferay</span>
						<strong {...stylex.props(styles.settingsNavTitle)}>Settings</strong>
					</div>
					<nav aria-label="Profile settings" {...stylex.props(styles.navList)}>
						<button
							type="button"
							onClick={() => scrollToSettingsSection("account")}
							{...stylex.props(
								styles.navItem,
								activeSettingsSection === "account" && styles.navItemActive,
							)}
						>
							<IconUser size={iconSize._2md} />
							<span>Account</span>
						</button>
						<button
							type="button"
							onClick={() => scrollToSettingsSection("agent-defaults")}
							{...stylex.props(
								styles.navItem,
								activeSettingsSection === "agent-defaults" &&
									styles.navItemActive,
							)}
						>
							<IconLayoutGrid size={iconSize._2md} />
							<span>Agents & Models</span>
						</button>
						<button
							type="button"
							onClick={() => scrollToSettingsSection("agent-instructions")}
							{...stylex.props(
								styles.navItem,
								activeSettingsSection === "agent-instructions" &&
									styles.navItemActive,
							)}
						>
							<IconSettings size={iconSize._2md} />
							<span>Agent instructions</span>
						</button>
						<button
							type="button"
							onClick={() => scrollToSettingsSection("workspace-layout")}
							{...stylex.props(
								styles.navItem,
								activeSettingsSection === "workspace-layout" &&
									styles.navItemActive,
							)}
						>
							<IconRobot size={iconSize._2md} />
							<span>Workspace</span>
						</button>
						<button
							type="button"
							onClick={() => scrollToSettingsSection("appearance")}
							{...stylex.props(
								styles.navItem,
								activeSettingsSection === "appearance" && styles.navItemActive,
							)}
						>
							<IconSettings size={iconSize._2md} />
							<span>Appearance</span>
						</button>
						<button
							type="button"
							onClick={() => scrollToSettingsSection("github")}
							{...stylex.props(
								styles.navItem,
								activeSettingsSection === "github" && styles.navItemActive,
							)}
						>
							<IconGitBranch size={iconSize._2md} />
							<span>GitHub</span>
						</button>
					</nav>
					<span {...stylex.props(styles.settingsNavVersion)}>
						Inferay {appInfo.version}
					</span>
				</aside>

				<WorkspaceContent scrollRef={settingsScrollRef} scroll padding="none">
					<div {...stylex.props(styles.content)}>
						<header {...stylex.props(styles.pageHeader)}>
							<span {...stylex.props(styles.pageEyebrow)}>Inferay</span>
							<h1 {...stylex.props(styles.pageTitle)}>Settings</h1>
							<p {...stylex.props(styles.pageDescription)}>
								Configure your account, agents, workspace, and appearance.
							</p>
						</header>

						<section id="account" {...stylex.props(styles.accountSection)}>
							<div {...stylex.props(styles.sectionIntro)}>
								<div {...stylex.props(styles.sectionIntroText)}>
									<h2 {...stylex.props(styles.sectionTitle)}>Account</h2>
									<p {...stylex.props(styles.sectionDescription)}>
										Your identity and local Inferay installation.
									</p>
								</div>
							</div>
							<section {...stylex.props(styles.profileSummary)}>
								<div {...stylex.props(styles.accountPreview)}>
									<ProfileAccountAvatar account={activeAccount} size="lg" />
									<div {...stylex.props(styles.rowText)}>
										<div {...stylex.props(styles.accountNameRow)}>
											<p {...stylex.props(styles.profileName)}>
												{activeAccount?.name ||
													activeAccount?.login ||
													"GitHub Account"}
											</p>
											<span
												{...stylex.props(
													styles.connectionPill,
													activeAccount
														? styles.connectionPillActive
														: styles.connectionPillIdle,
												)}
											>
												{activeAccount ? "Connected" : "Not connected"}
											</span>
										</div>
										<p {...stylex.props(styles.profileMeta)}>
											{activeAccount?.email ||
												(activeAccount
													? `@${activeAccount.login}`
													: "Connect GitHub to add your identity")}
										</p>
									</div>
								</div>
							</section>
							<div {...stylex.props(styles.accountDetails)}>
								<div {...stylex.props(styles.accountDetail)}>
									<span {...stylex.props(styles.accountDetailLabel)}>
										GitHub
									</span>
									<strong {...stylex.props(styles.accountDetailValue)}>
										{activeAccount ? `@${activeAccount.login}` : "Disconnected"}
									</strong>
								</div>
								<div {...stylex.props(styles.accountDetail)}>
									<span {...stylex.props(styles.accountDetailLabel)}>
										App version
									</span>
									<strong {...stylex.props(styles.accountDetailValue)}>
										{appInfo.version}
									</strong>
								</div>
								<div {...stylex.props(styles.profileActionCards)}>
									{!activeAccount ? (
										<Button
											liquid={false}
											type="button"
											onClick={connectGithub}
											disabled={connecting}
											variant="secondary"
											size="sm"
										>
											<IconAgent size={iconSize._2md} />
											<span>
												{connecting ? "Opening GitHub…" : "Connect GitHub"}
											</span>
										</Button>
									) : null}
									{!appInfo.production ? (
										<Button
											liquid={false}
											type="button"
											onClick={resetOnboarding}
											variant="secondary"
											size="sm"
										>
											<IconRefreshCw size={iconSize._2md} />
											<span>Replay onboarding</span>
										</Button>
									) : null}
								</div>
							</div>
						</section>

						<SettingsSection
							id="agent-defaults"
							title="Agents & Models"
							description="Choose the connected provider, model, and reasoning level used whenever you start a new chat."
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
											/>
										</div>
									) : null}
								</div>
							</div>
						</SettingsSection>

						<div {...stylex.props(styles.settingsSection)}>
							<SettingsContent showVersion={false} embedded />
						</div>

						<SettingsSection
							id="github"
							title="GitHub"
							description="Discover repositories from your connected account and clone them into an Inferay search folder."
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
							{resourceError ? (
								<ProfileErrorBanner message={resourceError} />
							) : null}
							{cloneStatus ? (
								<ProfileSuccessBanner message={cloneStatus} />
							) : null}

							{loadState === "loading" || accounts.length === 0 ? (
								<div {...stylex.props(styles.githubState)}>
									{loadState === "loading" ? (
										<div {...stylex.props(styles.accountLoadingState)}>
											Checking GitHub CLI account…
										</div>
									) : (
										<ProfileGithubEmptyState onConnect={connectGithub} />
									)}
								</div>
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
												<ProfileRepoRow
													key={repo.full_name}
													repo={repo}
													cloning={cloningRepo === repo.full_name}
													onClone={() => void cloneRepo(repo)}
												/>
											))
										)}
									</div>
								</>
							) : null}
						</SettingsSection>
					</div>
				</WorkspaceContent>
			</div>
		</WorkspacePage>
	);
}

const styles = stylex.create({
	settingsLayout: {
		display: "grid",
		flex: 1,
		gridTemplateColumns: {
			default: "1fr",
			[breakpoint.standard]: "14rem minmax(0, 1fr)",
		},
		minHeight: controlSize._0,
		minWidth: controlSize._0,
	},
	settingsNav: {
		backgroundColor: color.surfaceWhite01,
		borderBottomColor: color.border,
		borderBottomStyle: {
			default: "solid",
			[breakpoint.standard]: "none",
		},
		borderBottomWidth: {
			default: 1,
			[breakpoint.standard]: 0,
		},
		borderRightColor: color.border,
		borderRightStyle: {
			default: "none",
			[breakpoint.standard]: "solid",
		},
		borderRightWidth: {
			default: 0,
			[breakpoint.standard]: 1,
		},
		display: "flex",
		flexDirection: "column",
		gap: controlSize._6,
		minHeight: controlSize._0,
		paddingTop: controlSize._9,
		paddingBottom: controlSize._6,
		paddingInline: controlSize._3,
	},
	settingsNavHeader: {
		display: {
			default: "none",
			[breakpoint.standard]: "flex",
		},
		flexDirection: "column",
		gap: controlSize._1,
		paddingInline: controlSize._3,
	},
	settingsNavEyebrow: {
		color: color.textFaint,
		fontSize: font.size_0_5,
		fontWeight: font.weight_6,
		letterSpacing: "0.12em",
		textTransform: "uppercase",
	},
	settingsNavTitle: {
		color: color.textMain,
		fontSize: font.size_6,
		fontWeight: font.weight_6,
	},
	navList: {
		display: "flex",
		flexDirection: {
			default: "row",
			[breakpoint.standard]: "column",
		},
		gap: controlSize._0_5,
		overflowX: {
			default: "auto",
			[breakpoint.standard]: "visible",
		},
	},
	navItem: {
		alignItems: "center",
		borderRadius: radius.md,
		borderColor: color.transparent,
		borderStyle: "solid",
		borderWidth: 1,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlActive,
		},
		display: "flex",
		flexShrink: 0,
		fontSize: font.size_3,
		fontWeight: font.weight_5,
		gap: controlSize._2,
		minHeight: controlSize._9,
		paddingInline: controlSize._3,
		textAlign: "left",
		textDecoration: "none",
		transitionDuration: motion.durationFast,
		transitionProperty: "background-color, color",
		width: "100%",
	},
	navItemActive: {
		backgroundColor: color.surfaceWhite06,
		borderColor: color.borderSubtle,
		color: color.textMain,
	},
	settingsNavVersion: {
		color: color.textFaint,
		display: {
			default: "none",
			[breakpoint.standard]: "block",
		},
		fontSize: font.size_1,
		marginTop: "auto",
		paddingInline: controlSize._2,
	},
	settingsSection: {
		backgroundColor: color.surfaceWhite025,
		borderColor: color.borderSubtle,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._5,
		padding: controlSize._5,
		scrollMarginTop: controlSize._5,
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
		margin: controlSize._0,
	},
	sectionDescription: {
		color: color.textMuted,
		fontSize: font.size_2,
		lineHeight: 1.5,
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
	accountSection: {
		backgroundColor: color.surfaceWhite025,
		borderColor: color.borderSubtle,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._4,
		padding: controlSize._5,
		scrollMarginTop: controlSize._5,
	},
	accountPreview: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._3,
	},
	rowText: {
		minWidth: controlSize._0,
		flex: 1,
	},
	profileSummary: {
		display: "flex",
		alignItems: {
			default: "flex-start",
			[breakpoint.paneWide]: "center",
		},
		justifyContent: "space-between",
		gap: controlSize._4,
		paddingBlock: controlSize._1,
	},
	accountNameRow: {
		alignItems: "center",
		display: "flex",
		flexWrap: "wrap",
		gap: controlSize._2,
	},
	connectionPill: {
		borderRadius: radius.pill,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._2,
	},
	connectionPillActive: {
		backgroundColor: color.successWash,
		color: color.success,
	},
	connectionPillIdle: {
		backgroundColor: color.surfaceInset,
		color: color.textMuted,
	},
	accountDetails: {
		alignItems: {
			default: "stretch",
			[breakpoint.paneWide]: "center",
		},
		display: "grid",
		gap: controlSize._3,
		gridTemplateColumns: {
			default: "1fr",
			[breakpoint.paneWide]: "minmax(0, 1fr) minmax(0, 1fr) auto",
		},
		borderTopColor: color.borderSubtle,
		borderTopStyle: "solid",
		borderTopWidth: 1,
		paddingTop: controlSize._4,
	},
	accountDetail: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		minWidth: controlSize._0,
		paddingBlock: controlSize._1,
	},
	accountDetailLabel: {
		color: color.textFaint,
		fontSize: font.size_0_5,
		fontWeight: font.weight_6,
		letterSpacing: "0.06em",
		textTransform: "uppercase",
	},
	accountDetailValue: {
		color: color.textSoft,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	profileActionCards: {
		display: "flex",
		flexWrap: "wrap",
		gap: controlSize._2,
	},
	profileName: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontSize: font.size_4,
		fontWeight: font.weight_6,
	},
	profileMeta: {
		marginTop: "0.125rem",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_2,
	},
	defaultSettingsGrid: {
		display: "grid",
		gridTemplateColumns: {
			default: "1fr",
			[breakpoint.standard]: "repeat(2, minmax(0, 1fr))",
		},
		gap: controlSize._3,
	},
	agentDefaultsControl: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._4,
	},
	agentProviderGrid: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
	},
	agentProviderChoice: {
		alignItems: "center",
		display: "flex",
		backgroundColor: {
			default: color.transparent,
			":hover": color.backgroundRaised,
		},
		borderColor: color.transparent,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		fontSize: font.size_2,
		gap: controlSize._2,
		minHeight: controlSize._12,
		paddingBlock: controlSize._2_5,
		paddingInline: controlSize._3,
		textAlign: "left",
		":disabled": {
			opacity: 0.45,
		},
	},
	agentProviderChoiceActive: {
		backgroundColor: color.surfaceWhite06,
		borderColor: color.borderSubtle,
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
	noShrink: {
		flexShrink: 0,
	},
	flexInput: {
		flex: 1,
	},
	content: {
		display: "flex",
		maxWidth: "58rem",
		flexDirection: "column",
		gap: controlSize._4,
		marginInline: "auto",
		paddingBlock: controlSize._8,
		paddingInline: {
			default: controlSize._4,
			[breakpoint.standard]: controlSize._8,
		},
	},
	pageHeader: {
		marginBottom: controlSize._2,
		scrollMarginTop: controlSize._4,
	},
	pageEyebrow: {
		color: color.textFaint,
		fontSize: font.size_0_5,
		fontWeight: font.weight_6,
		letterSpacing: "0.12em",
		textTransform: "uppercase",
	},
	pageTitle: {
		color: color.textMain,
		fontSize: font.size_8,
		fontWeight: font.weight_6,
		marginBlockEnd: controlSize._0,
		marginBlockStart: controlSize._1,
	},
	pageDescription: {
		color: color.textMuted,
		fontSize: font.size_3,
		lineHeight: 1.5,
		marginBlockEnd: controlSize._0,
		marginBlockStart: controlSize._1,
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
	githubState: {
		minHeight: "7rem",
	},
});
