import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button.tsx";
import { DropdownButton } from "../../components/ui/DropdownButton.tsx";
import {
	IconAlertTriangle,
	IconCheck,
	IconExternalLink,
	IconGitBranch,
	IconPlus,
	IconRefreshCw,
	IconTerminal,
	IconUser,
	IconX,
} from "../../components/ui/Icons.tsx";
import { Notice, Panel, PanelHeader } from "../../components/ui/Surface.tsx";
import { TextInput } from "../../components/ui/TextInput.tsx";
import { getAgentIcon } from "../../features/agents/agent-ui.tsx";
import {
	type ChatAgentKind,
	CODEX_REASONING_LEVELS,
	getAgentDefinition,
	loadDefaultChatSettings,
	saveDefaultChatSettings,
} from "../../features/agents/agents.ts";
import { useAsyncResource } from "../../hooks/useAsyncResource.ts";
import { useAppInfo } from "../../hooks/useAppInfo.ts";
import {
	loadAppThemeId,
	mapAppThemeToTerminalTheme,
} from "../../lib/app-theme.ts";
import { isActive, lacksValue } from "../../lib/data.ts";
import { fetchJsonOr, sendJsonWithBusy } from "../../lib/fetch-json.ts";
import {
	fetchForgeAccounts,
	fetchGithubRepos,
	getCachedForgeAccounts,
	getCachedGithubRepos,
	invalidateForgeAccountsCache,
	invalidateGithubReposCache,
} from "../../lib/forge-client.ts";
import type { ForgeAccount, GithubRepo } from "../../lib/forge-types.ts";
import { setupTerminalThemePanelShortcut } from "../../lib/react-events.ts";
import { removeStoredValue } from "../../lib/stored-json.ts";
import type { ThemeId } from "../../features/terminal/terminal-utils.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";
import { ONBOARDING_DONE_KEY } from "../OnboardingPage/index.tsx";
import { TerminalSettingsPanel } from "../Terminal/TerminalSettingsPanel.tsx";

type LoadState = "idle" | "loading" | "ready" | "error";

async function fetchSimulatorProjectFolders(): Promise<string[]> {
	const response = await fetch("/api/simulator/project-folders");
	if (!response.ok) throw new Error(await response.text());
	const payload = (await response.json()) as { folders?: string[] };
	return Array.isArray(payload.folders) ? payload.folders : [];
}

export function ProfilePage() {
	const navigate = useNavigate();
	const resetOnboarding = () => {
		removeStoredValue(ONBOARDING_DONE_KEY);
		navigate("/onboarding", { replace: true });
	};
	const initialAccounts = getCachedForgeAccounts();
	const {
		data: accounts,
		loading: accountsLoading,
		error: accountsError,
		refresh: refreshAccounts,
	} = useAsyncResource(fetchForgeAccounts, initialAccounts, []);
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
	} = useAsyncResource(fetchSimulatorProjectFolders, [], []);
	const {
		data: repos,
		loading: reposLoading,
		error: reposError,
		refresh: refreshRepos,
	} = useAsyncResource(
		async () => (accounts.length > 0 ? fetchGithubRepos() : []),
		getCachedGithubRepos(),
		[accounts.length]
	);
	const [error, setError] = useState<string | null>(null);
	const [connecting, setConnecting] = useState(false);
	const [repoQuery, setRepoQuery] = useState("");
	const [cloneDirectory, setCloneDirectory] = useState("~/Desktop");
	const [cloneStatus, setCloneStatus] = useState<string | null>(null);
	const [cloningRepo, setCloningRepo] = useState<string | null>(null);
	const [showSettings, setShowSettings] = useState(false);
	const [themeId, setThemeId] = useState<ThemeId>(
		() => mapAppThemeToTerminalTheme(loadAppThemeId()) as ThemeId
	);
	const [defaultChatSettings, setDefaultChatSettings] = useState(() =>
		loadDefaultChatSettings()
	);
	const [simFoldersLoading, setSimFoldersLoading] = useState(false);
	const [simFoldersStatus, setSimFoldersStatus] = useState<string | null>(null);
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
			if (nextFolders.length > 0) navigate("/simulators");
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

	const loadAccounts = useCallback(
		async (force = false) => {
			setError(null);
			if (force) invalidateForgeAccountsCache();
			await refreshAccounts();
		},
		[refreshAccounts]
	);

	useEffect(setupTerminalThemePanelShortcut.bind(null, setShowSettings), []);

	const loadRepos = useCallback(
		async (force = false) => {
			setError(null);
			if (force) invalidateGithubReposCache();
			await refreshRepos();
		},
		[refreshRepos]
	);

	const resourceError =
		error ?? simProjectFoldersError ?? accountsError ?? reposError;

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
			window.dispatchEvent(new Event("terminal-shell-change"));
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Unable to clone repository"
			);
		} finally {
			setCloningRepo(null);
		}
	};

	return (
		<div {...stylex.props(styles.root)}>
			<main {...stylex.props(styles.main)}>
				<div {...stylex.props(styles.content)}>
					<section {...stylex.props(styles.profileSummary)}>
						<div {...stylex.props(styles.accountPreview)}>
							<AccountAvatar account={activeAccount} size="md" />
							<div {...stylex.props(styles.rowText)}>
								<p {...stylex.props(styles.profileName)}>
									{activeAccount?.name ||
										activeAccount?.login ||
										"GitHub Account"}
								</p>
								<p {...stylex.props(styles.profileMeta)}>
									{activeAccount ? `@${activeAccount.login}` : "Not connected"}
								</p>
								<p {...stylex.props(styles.versionMeta)}>
									inferay {appInfo.version}
								</p>
							</div>
						</div>
						<div {...stylex.props(styles.profileActionCards)}>
							{!activeAccount ? (
								<button
									type="button"
									onClick={connectGithub}
									disabled={connecting}
									{...stylex.props(styles.profileActionCard)}
								>
									<span {...stylex.props(styles.profileActionIcon)}>
										<IconTerminal size={14} />
									</span>
									<span {...stylex.props(styles.profileActionTextGroup)}>
										<span {...stylex.props(styles.profileActionTitle)}>
											{connecting ? "Opening..." : "Connect GitHub"}
										</span>
										<span {...stylex.props(styles.profileActionText)}>
											Use your local GitHub CLI login.
										</span>
									</span>
								</button>
							) : null}
							{!appInfo.production ? (
								<button
									type="button"
									onClick={resetOnboarding}
									{...stylex.props(styles.profileActionCard)}
								>
									<span {...stylex.props(styles.profileActionIcon)}>
										<IconRefreshCw size={14} />
									</span>
									<span {...stylex.props(styles.profileActionTextGroup)}>
										<span {...stylex.props(styles.profileActionTitle)}>
											Replay Onboarding
										</span>
										<span {...stylex.props(styles.profileActionText)}>
											Reset setup and walk through it again.
										</span>
									</span>
								</button>
							) : null}
						</div>
					</section>

					<Panel>
						<PanelHeader
							title="New Chat Defaults"
							description="Choose which agent, model, and reasoning level new panes use when you press New."
						/>
						<div {...stylex.props(styles.defaultSettingsGrid)}>
							<div {...stylex.props(styles.settingField)}>
								<span {...stylex.props(styles.settingLabel)}>Agent</span>
								<DropdownButton
									value={defaultChatSettings.agentKind}
									options={(["claude", "codex"] as const).map((kind) => ({
										id: kind,
										label: getAgentDefinition(kind).label,
										icon: getAgentIcon(kind, 12),
									}))}
									onChange={(id) => {
										const agentKind = id as ChatAgentKind;
										updateDefaultChatSettings({
											agentKind,
											model: getAgentDefinition(agentKind).defaultModel,
										});
									}}
									fullWidth
								/>
							</div>
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
									<span {...stylex.props(styles.settingLabel)}>Reasoning</span>
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
					</Panel>

					<Panel>
						<PanelHeader
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
										variant="primary"
										size="sm"
									>
										<IconPlus size={12} />
										<span>Add Folder</span>
									</Button>
								</div>
							}
						/>
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
					</Panel>

					<header {...stylex.props(styles.header)}>
						<div>
							<h1 {...stylex.props(styles.title)}>GitHub</h1>
							<p {...stylex.props(styles.description)}>
								Inferay uses your local GitHub CLI login for repositories.
							</p>
						</div>
						<div {...stylex.props(styles.headerActions)}>
							<Button
								type="button"
								onClick={() => void loadAccounts(true)}
								variant="secondary"
								size="sm"
							>
								<IconRefreshCw size={12} />
								<span>Refresh</span>
							</Button>
							{!activeAccount ? (
								<Button
									type="button"
									onClick={connectGithub}
									variant="primary"
									size="sm"
								>
									<IconTerminal size={12} />
									<span>Connect</span>
								</Button>
							) : null}
						</div>
					</header>

					{resourceError ? <ErrorBanner message={resourceError} /> : null}
					{cloneStatus ? <SuccessBanner message={cloneStatus} /> : null}

					{loadState === "loading" || accounts.length === 0 ? (
						<Panel>
							{loadState === "loading" ? (
								<div {...stylex.props(styles.accountLoadingState)}>
									Checking GitHub CLI account...
								</div>
							) : (
								<EmptyState onConnect={connectGithub} />
							)}
						</Panel>
					) : null}

					{accounts.length > 0 ? (
						<Panel>
							<PanelHeader
								title="Clone from GitHub"
								description="Discover repositories from your connected account and add the clone location to Inferay search."
								actions={
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
								}
							/>
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
										onChange={(event) => setCloneDirectory(event.target.value)}
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
										Loading repositories...
									</div>
								) : filteredRepos.length === 0 ? (
									<div {...stylex.props(styles.loadingState)}>
										No repositories found.
									</div>
								) : (
									filteredRepos.map((repo) => (
										<RepoRow
											key={repo.full_name}
											repo={repo}
											cloning={cloningRepo === repo.full_name}
											onClone={() => void cloneRepo(repo)}
										/>
									))
								)}
							</div>
						</Panel>
					) : null}
				</div>
			</main>
			{showSettings ? (
				<TerminalSettingsPanel
					themeId={themeId}
					onThemeChange={(nextThemeId: ThemeId) => setThemeId(nextThemeId)}
					onClose={setShowSettings.bind(null, false)}
				/>
			) : null}
		</div>
	);
}

function RepoRow({
	repo,
	cloning,
	onClone,
}: {
	repo: GithubRepo;
	cloning: boolean;
	onClone: () => void;
}) {
	return (
		<div {...stylex.props(styles.repoRow)}>
			<div {...stylex.props(styles.rowText)}>
				<div {...stylex.props(styles.inlineRow)}>
					<p {...stylex.props(styles.repoName)}>{repo.full_name}</p>
					{repo.private ? (
						<span {...stylex.props(styles.privatePill)}>Private</span>
					) : null}
				</div>
				<p {...stylex.props(styles.repoDescription)}>
					{repo.description || repo.language || "No description"}
				</p>
			</div>
			<a
				href={repo.html_url}
				target="_blank"
				rel="noreferrer"
				{...stylex.props(styles.externalLink)}
				title="Open on GitHub"
			>
				<IconExternalLink size={12} />
			</a>
			<Button
				type="button"
				onClick={onClone}
				disabled={cloning}
				variant="primary"
				size="sm"
			>
				<IconPlus size={12} />
				<span>{cloning ? "Cloning" : "Clone"}</span>
			</Button>
		</div>
	);
}

function AccountAvatar({
	account,
	size,
}: {
	account: ForgeAccount | null;
	size: "md" | "lg";
}) {
	const fallback = account?.login.slice(0, 2).toUpperCase() || "GH";

	return (
		<div
			{...stylex.props(
				styles.avatar,
				size === "lg" ? styles.avatarLg : styles.avatarMd
			)}
		>
			{account?.avatarUrl ? (
				<img
					src={account.avatarUrl}
					alt={account.login}
					{...stylex.props(styles.avatarImage)}
				/>
			) : account ? (
				fallback
			) : (
				<IconUser size={18} />
			)}
		</div>
	);
}

function EmptyState({ onConnect }: { onConnect: () => void }) {
	return (
		<div {...stylex.props(styles.emptyState)}>
			<div {...stylex.props(styles.emptyIcon)}>
				<IconGitBranch size={17} />
			</div>
			<div>
				<p {...stylex.props(styles.emptyTitle)}>No GitHub accounts found</p>
				<p {...stylex.props(styles.emptyText)}>
					Connect with the GitHub CLI and Inferay will pick up the account
					automatically.
				</p>
			</div>
			<Button type="button" onClick={onConnect} variant="primary" size="sm">
				<IconTerminal size={12} />
				<span>Run gh auth login</span>
			</Button>
		</div>
	);
}

function ErrorBanner({ message }: { message: string }) {
	return (
		<Notice tone="warning" icon={<IconAlertTriangle size={13} />}>
			{message}
		</Notice>
	);
}

function SuccessBanner({ message }: { message: string }) {
	return (
		<Notice tone="success" icon={<IconCheck size={13} />}>
			{message}
		</Notice>
	);
}

const styles = stylex.create({
	root: {
		display: "flex",
		height: "100%",
		minHeight: 0,
		backgroundColor: color.background,
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
		gap: controlSize._3,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		paddingBottom: controlSize._4,
	},
	profileActionCards: {
		display: "grid",
		gridTemplateColumns: {
			default: "1fr",
			"@media (min-width: 720px)": "repeat(2, minmax(0, 1fr))",
		},
		gap: controlSize._2,
		minWidth: {
			default: "100%",
			"@media (min-width: 720px)": "360px",
		},
	},
	profileActionCard: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._3,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._2,
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlActive,
		},
		padding: controlSize._3,
		textAlign: "left",
		transitionProperty: "background-color, opacity",
		transitionDuration: "120ms",
		":disabled": {
			cursor: "default",
			opacity: 0.7,
		},
	},
	profileActionIcon: {
		display: "flex",
		width: controlSize._7,
		height: controlSize._7,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._2,
		backgroundColor: color.background,
		color: color.textSoft,
	},
	profileActionTextGroup: {
		display: "flex",
		minWidth: 0,
		flexDirection: "column",
	},
	profileActionTitle: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontSize: font.size_3,
		fontWeight: font.weight_5,
	},
	profileActionText: {
		marginTop: "0.125rem",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_1,
	},
	profileName: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontSize: "0.8125rem",
		fontWeight: font.weight_5,
	},
	profileMeta: {
		marginTop: "0.125rem",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_2,
	},
	versionMeta: {
		marginTop: "0.1875rem",
		color: color.textMuted,
		fontSize: font.size_1,
	},
	defaultSettingsGrid: {
		display: "grid",
		gridTemplateColumns: {
			default: "1fr",
			"@media (min-width: 760px)": "repeat(3, minmax(0, 1fr))",
		},
		gap: controlSize._3,
		padding: controlSize._4,
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
	main: {
		minWidth: 0,
		flex: 1,
		overflowY: "auto",
	},
	content: {
		display: "flex",
		maxWidth: "56rem",
		flexDirection: "column",
		gap: controlSize._4,
		marginInline: "auto",
		paddingBlock: controlSize._5,
		paddingInline: controlSize._6,
	},
	header: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: controlSize._3,
	},
	title: {
		color: color.textMain,
		fontSize: "0.8125rem",
		fontWeight: font.weight_5,
	},
	description: {
		marginTop: controlSize._1,
		color: color.textMuted,
		fontSize: font.size_1,
	},
	headerActions: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
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
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: color.border,
		padding: controlSize._4,
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
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._2,
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlHover,
		},
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
	},
	projectFolderIcon: {
		display: "flex",
		width: controlSize._6,
		height: controlSize._6,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: controlSize._1,
		color: color.textMuted,
		backgroundColor: color.controlActive,
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
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._2,
		backgroundColor: color.backgroundRaised,
		color: color.textMuted,
		fontSize: font.size_2,
		lineHeight: 1.5,
		padding: controlSize._4,
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
		paddingInline: controlSize._4,
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
	repoRow: {
		display: "flex",
		minHeight: "64px",
		alignItems: "center",
		gap: controlSize._3,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		paddingBlock: controlSize._3,
		paddingInline: controlSize._4,
	},
	inlineRow: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
	},
	repoName: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
	},
	repoDescription: {
		marginTop: controlSize._1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: "0.5rem",
	},
	privatePill: {
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: "999px",
		color: color.textMuted,
		fontSize: "0.4375rem",
		paddingBlock: "0.125rem",
		paddingInline: "0.375rem",
	},
	externalLink: {
		display: "flex",
		width: controlSize._7,
		height: controlSize._7,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: "0.375rem",
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
		backgroundColor: {
			default: "transparent",
			":hover": color.backgroundRaised,
		},
		transitionProperty: "background-color, color",
		transitionDuration: "120ms",
	},
	avatar: {
		display: "flex",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		overflow: "hidden",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: "999px",
		backgroundColor: color.controlActive,
		color: color.textSoft,
		fontWeight: 600,
	},
	avatarMd: {
		width: "2.5rem",
		height: "2.5rem",
		fontSize: font.size_3,
	},
	avatarLg: {
		width: "2.5rem",
		height: "2.5rem",
		fontSize: "0.8125rem",
	},
	avatarImage: {
		width: "100%",
		height: "100%",
		objectFit: "cover",
	},
	emptyState: {
		display: "flex",
		minHeight: "180px",
		flexDirection: "column",
		alignItems: "center",
		justifyContent: "center",
		gap: controlSize._3,
		paddingInline: controlSize._6,
		textAlign: "center",
	},
	emptyIcon: {
		display: "flex",
		width: "2.5rem",
		height: "2.5rem",
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: "999px",
		backgroundColor: color.backgroundRaised,
		color: color.textMuted,
	},
	emptyTitle: {
		color: color.textMain,
		fontSize: "0.6875rem",
		fontWeight: font.weight_5,
	},
	emptyText: {
		maxWidth: "24rem",
		marginTop: controlSize._1,
		color: color.textMuted,
		fontSize: font.size_1,
		lineHeight: 1.55,
	},
});
