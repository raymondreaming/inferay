import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { useCallback, useMemo, useReducer, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button.tsx";
import { DropdownButton } from "../../components/ui/DropdownButton.tsx";
import {
	IconFolder,
	IconGitBranch,
	IconPlus,
	IconRefreshCw,
	IconRobot,
	IconSettings,
	IconTerminal,
	IconUser,
	IconX,
} from "../../components/ui/Icons.tsx";
import { TextInput } from "../../components/ui/TextInput.tsx";
import {
	WorkspaceContent,
	WorkspacePage,
} from "../../components/ui/WorkspacePage.tsx";
import type { AgentAccountProviderStatus } from "../../features/agents/agent-account-status.ts";
import { getAgentIcon } from "../../features/agents/agent-ui.tsx";
import {
	CODEX_REASONING_LEVELS,
	getAgentDefinition,
	loadDefaultChatSettings,
	saveDefaultChatSettings,
} from "../../features/agents/agents.ts";
import { dispatchTerminalShellChange } from "../../features/terminal/terminal-utils.ts";
import {
	fetchForgeAccounts,
	fetchGithubRepos,
	getCachedForgeAccounts,
	getCachedGithubRepos,
	invalidateGithubReposCache,
} from "../../features/forge/forge-client.ts";
import type { ForgeAccount, GithubRepo } from "../../features/forge/types.ts";
import { useAppInfo } from "../../hooks/useAppInfo.ts";
import { useAsyncResource } from "../../hooks/useAsyncResource.ts";
import { ONBOARDING_DONE_STORAGE_KEY } from "../../lib/client-storage-keys.ts";
import { isActive, lacksValue } from "../../lib/data.ts";
import { fetchJsonOr, sendJsonWithBusy } from "../../lib/fetch-json.ts";
import { removeStoredValue } from "../../lib/stored-json.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";
import { TerminalSettingsContent } from "../Terminal/TerminalSettingsPanel.tsx";
import { ProfileGithubEmptyState, ProfileRepoRow } from "./ProfileGithub.tsx";
import {
	ProfileAccountAvatar,
	ProfileErrorBanner,
	ProfileSuccessBanner,
} from "./ProfileStatus.tsx";

type LoadState = "idle" | "loading" | "ready" | "error";
type StateValue<T> = T | ((current: T) => T);

type ProfileUiState = {
	error: string | null;
	connecting: boolean;
	repoQuery: string;
	cloneDirectory: string;
	cloneStatus: string | null;
	cloningRepo: string | null;
	simFoldersLoading: boolean;
	simFoldersStatus: string | null;
};

type ProfileUiAction<K extends keyof ProfileUiState = keyof ProfileUiState> = {
	type: "fieldChanged";
	field: K;
	value: StateValue<ProfileUiState[K]>;
};

const initialProfileUiState: ProfileUiState = {
	error: null,
	connecting: false,
	repoQuery: "",
	cloneDirectory: "~/Desktop",
	cloneStatus: null,
	cloningRepo: null,
	simFoldersLoading: false,
	simFoldersStatus: null,
};

function resolveStateValue<T>(current: T, value: StateValue<T>): T {
	return typeof value === "function"
		? (value as (current: T) => T)(current)
		: value;
}

function profileUiReducer(
	state: ProfileUiState,
	action: ProfileUiAction
): ProfileUiState {
	switch (action.type) {
		case "fieldChanged": {
			const nextValue = resolveStateValue(
				state[action.field],
				action.value
			) as ProfileUiState[typeof action.field];
			if (Object.is(state[action.field], nextValue)) return state;
			return {
				...state,
				[action.field]: nextValue,
			};
		}
	}
}

async function fetchSimulatorProjectFolders(): Promise<string[]> {
	const response = await fetch("/api/simulator/project-folders");
	if (!response.ok) throw new Error(await response.text());
	const payload = (await response.json()) as { folders?: string[] };
	return Array.isArray(payload.folders) ? payload.folders : [];
}

function areStringArraysEqual(prev: string[], next: string[]) {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		if (prev[i] !== next[i]) return false;
	}
	return true;
}

function areForgeAccountsEqual(prev: ForgeAccount[], next: ForgeAccount[]) {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		const a = prev[i]!;
		const b = next[i]!;
		if (
			a.provider !== b.provider ||
			a.host !== b.host ||
			a.login !== b.login ||
			a.name !== b.name ||
			a.avatarUrl !== b.avatarUrl ||
			a.email !== b.email ||
			a.active !== b.active
		)
			return false;
	}
	return true;
}

function areGithubReposEqual(prev: GithubRepo[], next: GithubRepo[]) {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		const a = prev[i]!;
		const b = next[i]!;
		if (
			a.name !== b.name ||
			a.full_name !== b.full_name ||
			a.description !== b.description ||
			a.html_url !== b.html_url ||
			a.language !== b.language ||
			a.stargazers_count !== b.stargazers_count ||
			a.updated_at !== b.updated_at ||
			a.private !== b.private
		)
			return false;
	}
	return true;
}

function areAgentAccountStatusesEqual(
	prev: AgentAccountProviderStatus[],
	next: AgentAccountProviderStatus[]
) {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		const a = prev[i]!;
		const b = next[i]!;
		if (
			a.kind !== b.kind ||
			a.label !== b.label ||
			a.installed !== b.installed ||
			a.binaryPath !== b.binaryPath ||
			a.version !== b.version ||
			a.health !== b.health ||
			a.summary !== b.summary ||
			!areStringArraysEqual(a.authConfigPaths, b.authConfigPaths) ||
			!areStringArraysEqual(a.usageSignals, b.usageSignals)
		)
			return false;
	}
	return true;
}

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
	actions?: ReactNode;
	children: ReactNode;
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
		navigate("/onboarding", { replace: true });
	};
	const initialAccounts = getCachedForgeAccounts();
	const {
		data: accounts,
		loading: accountsLoading,
		error: accountsError,
	} = useAsyncResource(fetchForgeAccounts, initialAccounts, {
		isEqual: areForgeAccountsEqual,
	});
	const loadState: LoadState = accountsLoading
		? "loading"
		: accountsError
			? "error"
			: accounts.length > 0
				? "ready"
				: "idle";
	const {
		data: simProjectFolders,
		setData: setSimProjectFolders,
		error: simProjectFoldersError,
	} = useAsyncResource(fetchSimulatorProjectFolders, [], {
		isEqual: areStringArraysEqual,
	});
	const fetchRepos = useCallback(
		async () => (accounts.length > 0 ? fetchGithubRepos() : []),
		[accounts.length]
	);
	const {
		data: repos,
		loading: reposLoading,
		error: reposError,
		refresh: refreshRepos,
	} = useAsyncResource(fetchRepos, getCachedGithubRepos(), {
		isEqual: areGithubReposEqual,
	});
	const fetchAgentAccountStatuses = useCallback(
		async () =>
			fetchJsonOr<{ providers?: AgentAccountProviderStatus[] }>(
				"/api/agents/account-status",
				{}
			).then((payload) =>
				Array.isArray(payload.providers) ? payload.providers : []
			),
		[]
	);
	const {
		data: agentAccountStatuses,
		loading: agentAccountStatusesLoading,
		error: agentAccountStatusesError,
		refresh: refreshAgentAccountStatuses,
	} = useAsyncResource(fetchAgentAccountStatuses, [], {
		isEqual: areAgentAccountStatusesEqual,
	});
	const [profileUiState, profileUiDispatch] = useReducer(
		profileUiReducer,
		initialProfileUiState
	);
	const {
		error,
		connecting,
		repoQuery,
		cloneDirectory,
		cloneStatus,
		cloningRepo,
		simFoldersLoading,
		simFoldersStatus,
	} = profileUiState;
	const setProfileUiField = useCallback(
		<K extends keyof ProfileUiState>(
			field: K,
			value: StateValue<ProfileUiState[K]>
		) =>
			profileUiDispatch({
				type: "fieldChanged",
				field,
				value,
			} as ProfileUiAction),
		[]
	);
	const setError = useCallback(
		(value: StateValue<string | null>) => setProfileUiField("error", value),
		[setProfileUiField]
	);
	const setConnecting = useCallback(
		(value: StateValue<boolean>) => setProfileUiField("connecting", value),
		[setProfileUiField]
	);
	const setRepoQuery = useCallback(
		(value: StateValue<string>) => setProfileUiField("repoQuery", value),
		[setProfileUiField]
	);
	const setCloneDirectory = useCallback(
		(value: StateValue<string>) => setProfileUiField("cloneDirectory", value),
		[setProfileUiField]
	);
	const setCloneStatus = useCallback(
		(value: StateValue<string | null>) =>
			setProfileUiField("cloneStatus", value),
		[setProfileUiField]
	);
	const setCloningRepo = useCallback(
		(value: StateValue<string | null>) =>
			setProfileUiField("cloningRepo", value),
		[setProfileUiField]
	);
	const setSimFoldersLoading = useCallback(
		(value: StateValue<boolean>) =>
			setProfileUiField("simFoldersLoading", value),
		[setProfileUiField]
	);
	const setSimFoldersStatus = useCallback(
		(value: StateValue<string | null>) =>
			setProfileUiField("simFoldersStatus", value),
		[setProfileUiField]
	);
	const [defaultChatSettings, setDefaultChatSettings] = useState(() =>
		loadDefaultChatSettings()
	);
	const [activeSettingsSection, setActiveSettingsSection] = useState("account");
	const { data: appInfo } = useAppInfo();
	const defaultAgentDefinition = getAgentDefinition(
		defaultChatSettings.agentKind
	);
	const defaultModelOptions = defaultAgentDefinition.models.map((option) => ({
		...option,
		icon: getAgentIcon(defaultChatSettings.agentKind, 12),
	}));

	const updateDefaultChatSettings = (
		next: Partial<typeof defaultChatSettings>
	) => {
		const merged = loadDefaultChatSettings();
		const settings = { ...merged, ...next };
		const normalized = {
			...settings,
			model: getAgentDefinition(settings.agentKind).models.some(
				(option) => option.id === settings.model
			)
				? settings.model
				: getAgentDefinition(settings.agentKind).defaultModel,
		};
		saveDefaultChatSettings(normalized);
		setDefaultChatSettings(loadDefaultChatSettings());
	};
	const scrollToSettingsSection = useCallback((id: string) => {
		setActiveSettingsSection(id);
		document
			.getElementById(id)
			?.scrollIntoView({ behavior: "smooth", block: "start" });
	}, []);

	const saveSimulatorProjectFolders = async (folders: string[]) => {
		const uniqueFolders = [...new Set(folders.map((folder) => folder.trim()))]
			.filter(Boolean)
			.sort((a, b) => a.localeCompare(b));
		const response = await fetch("/api/simulator/project-folders", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ folders: uniqueFolders }),
		});
		if (!response.ok) throw new Error(await response.text());
		const payload = (await response.json()) as { folders?: string[] };
		const nextFolders = Array.isArray(payload.folders)
			? payload.folders
			: uniqueFolders;
		setSimProjectFolders(nextFolders);
		return nextFolders;
	};

	const addSimulatorProjectFolder = async () => {
		setSimFoldersLoading(true);
		setSimFoldersStatus(null);
		try {
			const response = await fetch("/api/simulator/project-folders/pick", {
				method: "POST",
			});
			if (!response.ok) throw new Error(await response.text());
			const payload = (await response.json()) as { folder?: string | null };
			if (!payload.folder) return;
			const nextFolders = await saveSimulatorProjectFolders([
				...simProjectFolders,
				payload.folder,
			]);
			setSimFoldersStatus(`${nextFolders.length} project folders configured.`);
			navigate("/simulators");
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Unable to add project folder"
			);
		} finally {
			setSimFoldersLoading(false);
		}
	};

	const autoDetectSimulatorProjectFolders = async () => {
		setSimFoldersLoading(true);
		setSimFoldersStatus(null);
		try {
			const response = await fetch("/api/simulator/project-folders/detect", {
				method: "POST",
			});
			if (!response.ok) throw new Error(await response.text());
			const payload = (await response.json()) as { folders?: string[] };
			const nextFolders = Array.isArray(payload.folders) ? payload.folders : [];
			setSimProjectFolders(nextFolders);
			setSimFoldersStatus(
				nextFolders.length
					? `${nextFolders.length} project folders configured.`
					: "No simulator projects were detected."
			);
			if (nextFolders.length > 0) {
				navigate("/simulators");
			}
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "Unable to detect simulator project folders"
			);
		} finally {
			setSimFoldersLoading(false);
		}
	};

	const removeSimulatorProjectFolder = async (folder: string) => {
		setSimFoldersLoading(true);
		setSimFoldersStatus(null);
		try {
			const nextFolders = await saveSimulatorProjectFolders(
				simProjectFolders.filter(lacksValue.bind(null, folder))
			);
			setSimFoldersStatus(`${nextFolders.length} project folders configured.`);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Unable to remove project folder"
			);
		} finally {
			setSimFoldersLoading(false);
		}
	};

	const loadRepos = useCallback(
		async (force = false) => {
			setError(null);
			if (force) invalidateGithubReposCache();
			await refreshRepos();
		},
		[refreshRepos, setError]
	);

	const resourceError =
		error ??
		simProjectFoldersError ??
		accountsError ??
		reposError ??
		agentAccountStatusesError;

	const activeAccount = useMemo(
		() => accounts.find(isActive) ?? accounts[0] ?? null,
		[accounts]
	);

	const filteredRepos = useMemo(() => {
		const query = repoQuery.trim().toLowerCase();
		if (!query) return repos;
		return repos.filter(
			(repo) =>
				repo.full_name.toLowerCase().includes(query) ||
				repo.description?.toLowerCase().includes(query)
		);
	}, [repoQuery, repos]);

	const connectGithub = sendJsonWithBusy.bind(
		null,
		setConnecting,
		"/api/forge/connect",
		{ provider: "github" },
		undefined
	);

	const pickCloneDirectory = async () => {
		const payload = await fetchJsonOr<{ folder: string | null }>(
			"/api/config/pick-folder",
			{ folder: null },
			{ method: "POST" }
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
			dispatchTerminalShellChange({ source: "cache", reason: "repo-cloned" });
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Unable to clone repository"
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
								activeSettingsSection === "account" && styles.navItemActive
							)}
						>
							<IconUser size={13} />
							<span>Account</span>
						</button>
						<button
							type="button"
							onClick={() => scrollToSettingsSection("agent-defaults")}
							{...stylex.props(
								styles.navItem,
								activeSettingsSection === "agent-defaults" &&
									styles.navItemActive
							)}
						>
							<IconRobot size={13} />
							<span>Agents & Models</span>
						</button>
						<button
							type="button"
							onClick={() => scrollToSettingsSection("appearance")}
							{...stylex.props(
								styles.navItem,
								activeSettingsSection === "appearance" && styles.navItemActive
							)}
						>
							<IconSettings size={13} />
							<span>Appearance</span>
						</button>
						<button
							type="button"
							onClick={() => scrollToSettingsSection("xcode-projects")}
							{...stylex.props(
								styles.navItem,
								activeSettingsSection === "xcode-projects" &&
									styles.navItemActive
							)}
						>
							<IconFolder size={13} />
							<span>Xcode projects</span>
						</button>
						<button
							type="button"
							onClick={() => scrollToSettingsSection("github")}
							{...stylex.props(
								styles.navItem,
								activeSettingsSection === "github" && styles.navItemActive
							)}
						>
							<IconGitBranch size={13} />
							<span>GitHub</span>
						</button>
					</nav>
					<span {...stylex.props(styles.settingsNavVersion)}>
						Inferay {appInfo.version}
					</span>
				</aside>

				<WorkspaceContent scroll padding="none">
					<div {...stylex.props(styles.content)}>
						<header id="account" {...stylex.props(styles.pageHeader)}>
							<span {...stylex.props(styles.pageEyebrow)}>Settings</span>
							<h1 {...stylex.props(styles.pageTitle)}>Account</h1>
							<p {...stylex.props(styles.pageDescription)}>
								Manage your identity, local agents, and workspace integrations.
							</p>
						</header>

						<section {...stylex.props(styles.accountSection)}>
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
														: styles.connectionPillIdle
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
											type="button"
											onClick={connectGithub}
											disabled={connecting}
											variant="secondary"
											size="sm"
										>
											<IconTerminal size={13} />
											<span>
												{connecting ? "Opening GitHub…" : "Connect GitHub"}
											</span>
										</Button>
									) : null}
									{!appInfo.production ? (
										<Button
											type="button"
											onClick={resetOnboarding}
											variant="secondary"
											size="sm"
										>
											<IconRefreshCw size={13} />
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
									type="button"
									onClick={() => void refreshAgentAccountStatuses()}
									variant="secondary"
									size="sm"
								>
									<IconRefreshCw size={12} />
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
												(item) => item.kind === agentKind
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
															styles.agentProviderChoiceActive
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

						<SettingsSection
							id="appearance"
							title="Appearance & Search"
							description="Choose the app theme, diff syntax theme, and folders Inferay searches for projects."
						>
							<TerminalSettingsContent showVersion={false} embedded />
						</SettingsSection>

						<SettingsSection
							id="xcode-projects"
							title="Xcode Projects"
							description="Configure folders Inferay scans for Xcode and React Native simulator apps."
							actions={
								<div {...stylex.props(styles.panelActions)}>
									<Button
										type="button"
										onClick={() => void autoDetectSimulatorProjectFolders()}
										disabled={simFoldersLoading}
										variant="secondary"
										size="sm"
									>
										<IconRefreshCw size={12} />
										<span>Auto Detect</span>
									</Button>
									<Button
										type="button"
										onClick={() => void addSimulatorProjectFolder()}
										disabled={simFoldersLoading}
										variant="secondary"
										size="sm"
									>
										<IconPlus size={12} />
										<span>Add Folder</span>
									</Button>
								</div>
							}
						>
							<div {...stylex.props(styles.projectFolderBody)}>
								{simProjectFolders.length === 0 ? (
									<div {...stylex.props(styles.projectFolderEmpty)}>
										Add your iOS app root, Xcode project folder, or React Native
										repo so Simulators can build and launch it.
									</div>
								) : (
									<div {...stylex.props(styles.projectFolderList)}>
										{simProjectFolders.map((folder) => (
											<div
												key={folder}
												{...stylex.props(styles.projectFolderRow)}
											>
												<div {...stylex.props(styles.projectFolderIcon)}>
													<IconTerminal size={13} />
												</div>
												<span {...stylex.props(styles.projectFolderPath)}>
													{folder}
												</span>
												<button
													type="button"
													aria-label={`Remove ${folder}`}
													onClick={() =>
														void removeSimulatorProjectFolder(folder)
													}
													disabled={simFoldersLoading}
													{...stylex.props(styles.projectFolderRemove)}
												>
													<IconX size={12} />
												</button>
											</div>
										))}
									</div>
								)}
								{simFoldersStatus ? (
									<p {...stylex.props(styles.projectFolderStatus)}>
										{simFoldersStatus}
									</p>
								) : null}
							</div>
						</SettingsSection>

						<SettingsSection
							id="github"
							title="GitHub"
							description="Discover repositories from your connected account and clone them into an Inferay search folder."
							actions={
								accounts.length > 0 ? (
									<Button
										type="button"
										onClick={() => void loadRepos(true)}
										variant="secondary"
										size="sm"
										className={stylex.props(styles.noShrink).className}
									>
										<IconRefreshCw size={12} />
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
											onChange={(event) => setRepoQuery(event.target.value)}
											placeholder="Search repositories"
											fullWidth
											className={stylex.props(styles.flexInput).className}
										/>
										<div {...stylex.props(styles.cloneDirControls)}>
											<TextInput
												type="text"
												value={cloneDirectory}
												onChange={(event) =>
													setCloneDirectory(event.target.value)
												}
												fullWidth
												className={stylex.props(styles.flexInput).className}
											/>
											<Button
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
			"@media (min-width: 760px)": "12.5rem minmax(0, 1fr)",
		},
		minHeight: 0,
		minWidth: 0,
	},
	settingsNav: {
		backgroundColor:
			"color-mix(in srgb, var(--color-inferay-black) 58%, transparent)",
		borderBottomColor: color.border,
		borderBottomStyle: {
			default: "solid",
			"@media (min-width: 760px)": "none",
		},
		borderBottomWidth: {
			default: 1,
			"@media (min-width: 760px)": 0,
		},
		borderRightColor: color.border,
		borderRightStyle: {
			default: "none",
			"@media (min-width: 760px)": "solid",
		},
		borderRightWidth: {
			default: 0,
			"@media (min-width: 760px)": 1,
		},
		display: "flex",
		flexDirection: "column",
		gap: controlSize._5,
		minHeight: 0,
		paddingBlock: controlSize._5,
		paddingInline: controlSize._4,
	},
	settingsNavHeader: {
		display: {
			default: "none",
			"@media (min-width: 760px)": "flex",
		},
		flexDirection: "column",
		gap: controlSize._1,
		paddingInline: controlSize._2,
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
		fontSize: font.size_5,
		fontWeight: font.weight_6,
	},
	navList: {
		display: "flex",
		flexDirection: {
			default: "row",
			"@media (min-width: 760px)": "column",
		},
		gap: controlSize._1,
		overflowX: {
			default: "auto",
			"@media (min-width: 760px)": "visible",
		},
	},
	navItem: {
		alignItems: "center",
		borderRadius: controlSize._1,
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
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		gap: controlSize._2,
		minHeight: controlSize._8,
		paddingInline: controlSize._2,
		textAlign: "left",
		textDecoration: "none",
		transitionDuration: "120ms",
		transitionProperty: "background-color, color",
		width: "100%",
	},
	navItemActive: {
		backgroundColor: color.backgroundRaised,
		borderColor: color.border,
		color: color.textMain,
	},
	settingsNavVersion: {
		color: color.textFaint,
		display: {
			default: "none",
			"@media (min-width: 760px)": "block",
		},
		fontSize: font.size_1,
		marginTop: "auto",
		paddingInline: controlSize._2,
	},
	settingsSection: {
		borderTopColor: color.borderSubtle,
		borderTopStyle: "solid",
		borderTopWidth: 1,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._4,
		paddingBlock: controlSize._6,
		scrollMarginTop: controlSize._4,
	},
	sectionIntro: {
		alignItems: {
			default: "flex-start",
			"@media (min-width: 640px)": "center",
		},
		display: "flex",
		gap: controlSize._4,
		justifyContent: "space-between",
	},
	sectionIntroText: {
		minWidth: 0,
	},
	sectionTitle: {
		color: color.textMain,
		fontSize: font.size_4,
		fontWeight: font.weight_6,
		margin: 0,
	},
	sectionDescription: {
		color: color.textMuted,
		fontSize: font.size_2,
		lineHeight: 1.5,
		marginBlockEnd: 0,
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
		borderBottomColor: color.borderSubtle,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
	},
	accountPreview: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._3,
	},
	rowText: {
		minWidth: 0,
		flex: 1,
	},
	profileSummary: {
		display: "flex",
		alignItems: {
			default: "flex-start",
			"@media (min-width: 720px)": "center",
		},
		justifyContent: "space-between",
		gap: controlSize._4,
		paddingBlock: controlSize._4,
	},
	accountNameRow: {
		alignItems: "center",
		display: "flex",
		flexWrap: "wrap",
		gap: controlSize._2,
	},
	connectionPill: {
		borderRadius: "999px",
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
			"@media (min-width: 720px)": "center",
		},
		display: "grid",
		gap: controlSize._3,
		gridTemplateColumns: {
			default: "1fr",
			"@media (min-width: 720px)": "minmax(0, 1fr) minmax(0, 1fr) auto",
		},
		borderTopColor: color.borderSubtle,
		borderTopStyle: "solid",
		borderTopWidth: 1,
		paddingBlock: controlSize._3,
	},
	accountDetail: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		minWidth: 0,
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
			"@media (min-width: 760px)": "repeat(2, minmax(0, 1fr))",
		},
		gap: controlSize._3,
	},
	agentDefaultsControl: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._4,
	},
	agentProviderGrid: {
		display: "grid",
		gap: controlSize._2,
		gridTemplateColumns: {
			default: "1fr",
			"@media (min-width: 560px)": "repeat(2, minmax(0, 1fr))",
		},
	},
	agentProviderChoice: {
		alignItems: "center",
		display: "flex",
		backgroundColor: {
			default: color.transparent,
			":hover": color.backgroundRaised,
		},
		borderColor: color.transparent,
		borderRadius: controlSize._2,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		fontSize: font.size_2,
		gap: controlSize._2,
		minHeight: controlSize._10,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
		textAlign: "left",
		":disabled": {
			opacity: 0.45,
		},
	},
	agentProviderChoiceActive: {
		backgroundColor: color.backgroundRaised,
		borderColor: color.border,
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
		minWidth: 0,
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
		minWidth: 0,
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
		maxWidth: "52rem",
		flexDirection: "column",
		gap: 0,
		marginInline: "auto",
		paddingBlock: controlSize._6,
		paddingInline: {
			default: controlSize._4,
			"@media (min-width: 760px)": controlSize._6,
		},
	},
	pageHeader: {
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
		fontSize: "1.125rem",
		fontWeight: font.weight_6,
		marginBlockEnd: 0,
		marginBlockStart: controlSize._2,
	},
	pageDescription: {
		color: color.textMuted,
		fontSize: font.size_3,
		lineHeight: 1.5,
		marginBlockEnd: 0,
		marginBlockStart: controlSize._1,
	},
	panelActions: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
	},
	projectFolderBody: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
	},
	projectFolderList: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
	},
	projectFolderRow: {
		display: "flex",
		minHeight: "2.25rem",
		alignItems: "center",
		gap: controlSize._2,
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceSubtle,
		},
		paddingBlock: controlSize._1,
		paddingInline: 0,
	},
	projectFolderIcon: {
		display: "flex",
		width: controlSize._6,
		height: controlSize._6,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		color: color.textMuted,
	},
	projectFolderPath: {
		minWidth: 0,
		flex: 1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontSize: font.size_2,
	},
	projectFolderRemove: {
		display: "flex",
		width: controlSize._6,
		height: controlSize._6,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.transparent,
		borderRadius: controlSize._1,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
		":disabled": {
			opacity: 0.45,
		},
	},
	projectFolderEmpty: {
		display: "flex",
		minHeight: "5rem",
		alignItems: "center",
		justifyContent: "center",
		color: color.textMuted,
		fontSize: font.size_2,
		lineHeight: 1.5,
		paddingBlock: controlSize._4,
		textAlign: "center",
	},
	projectFolderStatus: {
		color: color.textMuted,
		fontSize: font.size_1,
	},
	cloneControls: {
		display: "flex",
		flexDirection: {
			default: "column",
			"@media (min-width: 768px)": "row",
		},
		gap: controlSize._2,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		paddingBlock: controlSize._3,
	},
	cloneDirControls: {
		display: "flex",
		minWidth: 0,
		alignItems: "center",
		gap: controlSize._2,
		width: {
			default: "auto",
			"@media (min-width: 768px)": "320px",
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
		fontSize: "0.625rem",
	},
	githubState: {
		minHeight: "7rem",
	},
});
