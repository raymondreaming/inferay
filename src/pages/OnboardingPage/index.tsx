import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import {
	IconArrowLeft,
	IconCheck,
	IconChevronRight,
	IconFolder,
	IconFolderOpen,
	IconGitBranch,
	IconGlobe,
	IconRefreshCw,
	IconTerminal,
	IconUser,
	IconX,
} from "../../components/ui/Icons.tsx";
import { useAsyncResource } from "../../hooks/useAsyncResource.ts";
import { resolveServerUrl } from "../../lib/server-origin.ts";
import { writeStoredValue } from "../../lib/stored-json.ts";
import {
	createDefaultAgentChatGroup,
	DEFAULT_FONT_FAMILY,
	DEFAULT_FONT_SIZE,
	DEFAULT_OPACITY,
	loadTerminalState,
	saveTerminalState,
} from "../../features/terminal/terminal-utils.ts";
import { lacksValue } from "../../lib/data.ts";
import { fetchJsonOr, sendJsonWithBusy } from "../../lib/fetch-json.ts";
import {
	fetchForgeAccounts,
	fetchGithubRepos,
	invalidateForgeAccountsCache,
} from "../../features/forge/forge-client.ts";
import type { ForgeAccount, GithubRepo } from "../../features/forge/types.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";

export const ONBOARDING_DONE_KEY = "inferay-onboarding-done";

/* ─── Types ─── */

type Step = "intro" | "github" | "projects" | "complete";

const EASING = "cubic-bezier(.22,.82,.2,1)";
const logoUrl = resolveServerUrl("/logo.png");

/* ─── Transition helpers ─── */

function stepClass(
	current: Step,
	target: Step,
	{ active, before, after }: { active: string; before: string; after: string }
) {
	const order: Step[] = ["intro", "github", "projects", "complete"];
	const ci = order.indexOf(current);
	const ti = order.indexOf(target);
	if (ci === ti) return active;
	return ci < ti ? before : after;
}

/* ─── Main component ─── */

export function OnboardingPage() {
	const navigate = useNavigate();
	const [step, setStep] = useState<Step>("intro");

	const {
		data: accounts,
		setData: setAccounts,
		loading: accountsLoading,
	} = useAsyncResource(fetchForgeAccounts, [], []);
	const [connecting, setConnecting] = useState(false);
	const {
		data: repos,
		loading: reposLoading,
		refresh: refreshRepos,
	} = useAsyncResource(
		async () => (accounts.length > 0 ? fetchGithubRepos() : []),
		[],
		[accounts.length]
	);

	// Local folders
	const [localFolders, setLocalFolders] = useState<string[]>([]);
	const [isAddingFolder, setIsAddingFolder] = useState(false);

	// Selected repos
	const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());

	const refreshAccounts = async () => {
		invalidateForgeAccountsCache();
		setAccounts(await fetchForgeAccounts(true));
	};

	const connectGithub = async () => {
		await sendJsonWithBusy(setConnecting, "/api/forge/connect", {
			provider: "github",
		});
		invalidateForgeAccountsCache();
		setAccounts(await fetchForgeAccounts(true));
	};

	useEffect(() => {
		if (step !== "github" || accounts.length > 0 || connecting) return;
		const id = window.setInterval(() => {
			invalidateForgeAccountsCache();
			fetchForgeAccounts(true)
				.then(setAccounts)
				.catch(() => undefined);
		}, 3000);
		return () => window.clearInterval(id);
	}, [accounts.length, connecting, step]);

	const pickFolder = async () => {
		if (isAddingFolder) return;
		setIsAddingFolder(true);
		try {
			const data = await fetchJsonOr<{ folder: string | null }>(
				"/api/config/pick-folder",
				{ folder: null },
				{ method: "POST" }
			);
			if (data.folder && !localFolders.includes(data.folder)) {
				setLocalFolders((prev) => [...prev, data.folder as string]);
			}
		} catch {
			// ignore
		} finally {
			setIsAddingFolder(false);
		}
	};

	const removeFolder = (folder: string) => {
		setLocalFolders((prev) => prev.filter(lacksValue.bind(null, folder)));
	};

	const toggleRepo = (fullName: string) => {
		setSelectedRepos((prev) => {
			const next = new Set(prev);
			if (next.has(fullName)) next.delete(fullName);
			else next.add(fullName);
			return next;
		});
	};

	const finish = useCallback(() => {
		writeStoredValue(ONBOARDING_DONE_KEY, "true");
		// Default to grid layout
		writeStoredValue("terminal-layout-mode", "grid");
		writeStoredValue("terminal-main-view", "chat");
		// New users land directly in the multi-agent chat grid.
		if (!loadTerminalState()) {
			const group = createDefaultAgentChatGroup();
			const groupId = group.id;
			saveTerminalState({
				groups: [group],
				selectedGroupId: groupId,
				themeId: "default",
				fontSize: DEFAULT_FONT_SIZE,
				fontFamily: DEFAULT_FONT_FAMILY,
				opacity: DEFAULT_OPACITY,
			});
		}
		navigate("/terminal", { replace: true });
	}, [navigate]);

	const completeOnboarding = useCallback(() => {
		setStep("complete");
		window.setTimeout(finish, 600);
	}, [finish]);

	return (
		<main {...stylex.props(styles.root)}>
			{/* Grid background — like Helmor */}
			<div
				aria-hidden
				className={`pointer-events-none absolute inset-0 transition-opacity duration-700 ${step === "complete" ? "opacity-0" : "opacity-[0.09]"}`}
				style={{
					backgroundImage:
						"linear-gradient(to right, var(--color-inferay-white) 1px, transparent 1px), linear-gradient(to bottom, var(--color-inferay-white) 1px, transparent 1px)",
					backgroundSize: "42px 42px",
					maskImage:
						"radial-gradient(ellipse 82% 68% at 50% 42%, black 15%, transparent 78%)",
					transitionTimingFunction: EASING,
				}}
			/>
			{/* Bottom fade */}
			<div
				aria-hidden
				{...stylex.props(styles.bottomFade)}
				style={{
					background:
						"linear-gradient(to top, var(--color-inferay-black), transparent)",
				}}
			/>

			{/* All steps rendered simultaneously — CSS transitions only */}
			<IntroStep
				step={step}
				onNext={setStep.bind(null, "github")}
				onSkip={finish}
			/>
			<GithubStep
				step={step}
				accounts={accounts}
				loading={accountsLoading}
				connecting={connecting}
				onConnect={connectGithub}
				onRefresh={refreshAccounts}
				onBack={setStep.bind(null, "intro")}
				onNext={setStep.bind(null, "projects")}
			/>
			<ProjectsStep
				step={step}
				repos={repos}
				reposLoading={reposLoading}
				hasGithub={accounts.length > 0}
				selected={selectedRepos}
				onToggle={toggleRepo}
				onRefreshRepos={refreshRepos}
				localFolders={localFolders}
				isAddingFolder={isAddingFolder}
				onPickFolder={pickFolder}
				onRemoveFolder={removeFolder}
				onBack={setStep.bind(null, "github")}
				onComplete={completeOnboarding}
			/>
		</main>
	);
}

/* ─── Step: Intro ─── */

function IntroStep({
	step,
	onNext,
	onSkip,
}: {
	step: Step;
	onNext: () => void;
	onSkip: () => void;
}) {
	const vis = stepClass(step, "intro", {
		active: "translate-x-0 translate-y-0 opacity-100",
		before: "pointer-events-none translate-x-[40vw] opacity-0",
		after: "pointer-events-none -translate-x-[40vw] opacity-0",
	});

	return (
		<section
			aria-hidden={step !== "intro"}
			className={`absolute inset-0 z-10 flex items-center justify-center transition-all duration-700 ${vis}`}
			style={{ transitionTimingFunction: EASING }}
		>
			<div {...stylex.props(styles.introStack)}>
				<div {...stylex.props(styles.logoFrame)}>
					<img
						src={logoUrl}
						alt=""
						draggable={false}
						{...stylex.props(styles.logo)}
					/>
				</div>
				<h1 {...stylex.props(styles.heroTitle)}>Welcome to Inferay</h1>
				<p {...stylex.props(styles.heroText)}>
					Multi-agent terminal workbench. Connect your GitHub, bring in your
					projects, and start building.
				</p>

				<div {...stylex.props(styles.primaryActions)}>
					<Button type="button" onClick={onNext} variant="primary" size="lg">
						Get started
						<IconChevronRight size={16} />
					</Button>
				</div>
				<button
					type="button"
					onClick={onSkip}
					{...stylex.props(styles.skipButton)}
				>
					Skip setup
				</button>
			</div>
		</section>
	);
}

/* ─── Step: GitHub ─── */

function GithubStep({
	step,
	accounts,
	loading,
	connecting,
	onConnect,
	onRefresh,
	onBack,
	onNext,
}: {
	step: Step;
	accounts: ForgeAccount[];
	loading: boolean;
	connecting: boolean;
	onConnect: () => void;
	onRefresh: () => void;
	onBack: () => void;
	onNext: () => void;
}) {
	const vis = stepClass(step, "github", {
		active: "translate-x-0 translate-y-0 opacity-100",
		before:
			"pointer-events-none translate-x-[40vw] translate-y-[8vh] opacity-0 blur-sm",
		after:
			"pointer-events-none -translate-x-[40vw] translate-y-[8vh] opacity-0 blur-sm",
	});

	return (
		<section
			aria-hidden={step !== "github"}
			className={`absolute inset-0 z-10 flex items-center justify-center transition-all duration-700 ${vis}`}
			style={{ transitionTimingFunction: EASING }}
		>
			<div {...stylex.props(styles.stepPanel)}>
				<div {...stylex.props(styles.centerText)}>
					<h2 {...stylex.props(styles.stepTitle)}>Connect GitHub</h2>
					<p {...stylex.props(styles.stepDescription)}>
						Inferay detects accounts from the GitHub CLI. If you already have{" "}
						<span {...stylex.props(styles.inlineCodeText)}>gh</span>{" "}
						authenticated, your account appears automatically.
					</p>
				</div>

				<div {...stylex.props(styles.stepContent)}>
					{loading ? (
						<div {...stylex.props(styles.loadingState)}>
							<IconRefreshCw size={15} {...stylex.props(styles.spinIcon)} />
							Checking gh auth status...
						</div>
					) : accounts.length > 0 ? (
						<div {...stylex.props(styles.accountList)}>
							{accounts.map((account) => (
								<div
									key={`${account.host}:${account.login}`}
									{...stylex.props(styles.accountRow)}
								>
									<div {...stylex.props(styles.avatarFrame)}>
										{account.avatarUrl ? (
											<img
												src={account.avatarUrl}
												alt={account.login}
												{...stylex.props(styles.avatar)}
											/>
										) : (
											<IconUser size={18} {...stylex.props(styles.mutedIcon)} />
										)}
									</div>
									<div {...stylex.props(styles.rowText)}>
										<p {...stylex.props(styles.accountName)}>
											{account.name || account.login}
										</p>
										<p {...stylex.props(styles.accountMeta)}>
											@{account.login} · {account.host}
										</p>
									</div>
								</div>
							))}
						</div>
					) : (
						<div {...stylex.props(styles.noticeCard)}>
							<div {...stylex.props(styles.noticeIconBox)}>
								<IconGitBranch size={20} />
							</div>
							<p {...stylex.props(styles.noticeTitle)}>
								No GitHub accounts detected
							</p>
							<p {...stylex.props(styles.noticeText)}>
								Run the GitHub CLI login to connect your account.
							</p>
							<div {...stylex.props(styles.noticeActions)}>
								<Button
									type="button"
									onClick={onConnect}
									disabled={connecting}
									variant="secondary"
									size="lg"
								>
									<IconTerminal size={14} />
									{connecting ? "Opening terminal..." : "Run gh auth login"}
								</Button>
								<Button
									type="button"
									onClick={onRefresh}
									disabled={loading}
									variant="ghost"
									size="lg"
								>
									<IconRefreshCw size={13} />
									Refresh
								</Button>
							</div>
						</div>
					)}
				</div>

				<div {...stylex.props(styles.primaryActions)}>
					<Button type="button" onClick={onBack} variant="ghost" size="lg">
						<IconArrowLeft size={16} />
						Back
					</Button>
					<Button type="button" onClick={onNext} variant="primary" size="lg">
						{accounts.length > 0 ? "Continue" : "Skip"}
						<IconChevronRight size={16} />
					</Button>
				</div>
			</div>
		</section>
	);
}

/* ─── Step: Projects ─── */

function ProjectsStep({
	step,
	repos,
	reposLoading,
	hasGithub,
	selected,
	onToggle,
	onRefreshRepos,
	localFolders,
	isAddingFolder,
	onPickFolder,
	onRemoveFolder,
	onBack,
	onComplete,
}: {
	step: Step;
	repos: GithubRepo[];
	reposLoading: boolean;
	hasGithub: boolean;
	selected: Set<string>;
	onToggle: (fullName: string) => void;
	onRefreshRepos: () => void;
	localFolders: string[];
	isAddingFolder: boolean;
	onPickFolder: () => void;
	onRemoveFolder: (folder: string) => void;
	onBack: () => void;
	onComplete: () => void;
}) {
	const totalProjects = selected.size + localFolders.length;

	const vis = stepClass(step, "projects", {
		active: "translate-x-0 translate-y-0 opacity-100",
		before:
			"pointer-events-none translate-x-[40vw] translate-y-[8vh] opacity-0 blur-sm",
		after:
			"pointer-events-none -translate-x-[18vw] -translate-y-[16vh] scale-[1.08] opacity-0 blur-sm",
	});

	return (
		<section
			aria-hidden={step !== "projects"}
			className={`absolute inset-0 z-10 flex items-center justify-center transition-all duration-1000 ${vis}`}
			style={{ transitionTimingFunction: EASING }}
		>
			<div {...stylex.props(styles.projectPanel)}>
				<div {...stylex.props(styles.centerText)}>
					<h2 {...stylex.props(styles.stepTitle)}>Bring in your projects</h2>
					<p {...stylex.props(styles.stepDescription)}>
						Start with a local folder or select repositories from GitHub. You
						can add more anytime.
					</p>
				</div>

				<div {...stylex.props(styles.actionCards)}>
					<button
						type="button"
						onClick={onPickFolder}
						disabled={isAddingFolder}
						{...stylex.props(styles.projectActionCard)}
					>
						<div {...stylex.props(styles.projectActionIcon)}>
							<IconFolderOpen size={20} />
						</div>
						<div {...stylex.props(styles.projectActionTitle)}>
							Choose local project
						</div>
						<p {...stylex.props(styles.projectActionText)}>
							Add a folder already on this machine.
						</p>
					</button>
					<button
						type="button"
						onClick={hasGithub ? onRefreshRepos : undefined}
						disabled={!hasGithub || reposLoading}
						{...stylex.props(styles.projectActionCard)}
					>
						<div {...stylex.props(styles.projectActionIcon)}>
							<IconGlobe size={20} />
						</div>
						<div {...stylex.props(styles.projectActionTitle)}>
							Import from GitHub
						</div>
						<p {...stylex.props(styles.projectActionText)}>
							{hasGithub
								? "Select from your repositories below."
								: "Connect GitHub first to browse repos."}
						</p>
					</button>
				</div>

				{/* Added projects list */}
				<div {...stylex.props(styles.projectListSection)}>
					<div {...stylex.props(styles.listMeta)}>
						<span>
							{hasGithub && repos.length > 0
								? "Your repositories"
								: localFolders.length > 0
									? "Added projects"
									: "Projects"}
						</span>
						{totalProjects > 0 && <span>{totalProjects}</span>}
					</div>
					<div {...stylex.props(styles.projectList)}>
						{localFolders.map((folder) => (
							<div key={folder} {...stylex.props(styles.localFolderRow)}>
								<IconFolder
									size={14}
									{...stylex.props(styles.mutedIcon, styles.shrink)}
								/>
								<div {...stylex.props(styles.rowText)}>
									<p {...stylex.props(styles.repoName)}>{folder}</p>
								</div>
								<IconButton
									type="button"
									onClick={() => onRemoveFolder(folder)}
									variant="danger"
									size="xs"
								>
									<IconX size={14} />
								</IconButton>
							</div>
						))}

						{hasGithub && reposLoading ? (
							<div {...stylex.props(styles.loadingState)}>
								<IconRefreshCw size={13} {...stylex.props(styles.spinIcon)} />
								Loading repositories...
							</div>
						) : hasGithub && repos.length > 0 ? (
							repos.map((repo) => {
								const isSelected = selected.has(repo.full_name);
								return (
									<button
										type="button"
										key={repo.full_name}
										onClick={() => onToggle(repo.full_name)}
										{...stylex.props(
											styles.repoRow,
											isSelected && styles.repoRowSelected
										)}
									>
										<div
											{...stylex.props(
												styles.repoCheck,
												isSelected && styles.repoCheckSelected
											)}
										>
											{isSelected && <IconCheck size={10} />}
										</div>
										<div {...stylex.props(styles.rowText)}>
											<p {...stylex.props(styles.repoName)}>{repo.full_name}</p>
											{repo.description && (
												<p {...stylex.props(styles.repoDescription)}>
													{repo.description}
												</p>
											)}
										</div>
										<div {...stylex.props(styles.repoMeta)}>
											{repo.language && (
												<span {...stylex.props(styles.repoLanguage)}>
													{repo.language}
												</span>
											)}
											{repo.private && (
												<span {...stylex.props(styles.privatePill)}>
													private
												</span>
											)}
										</div>
									</button>
								);
							})
						) : localFolders.length === 0 ? (
							<div {...stylex.props(styles.projectEmpty)}>
								Choose a local folder or select GitHub repos
								<br />
								to get started.
							</div>
						) : null}
					</div>
				</div>

				<div {...stylex.props(styles.primaryActions)}>
					<Button type="button" onClick={onBack} variant="ghost" size="lg">
						<IconArrowLeft size={16} />
						Back
					</Button>
					<Button
						type="button"
						onClick={onComplete}
						variant="primary"
						size="lg"
					>
						{totalProjects > 0 ? "Let's build" : "Skip & enter"}
						<IconChevronRight size={16} />
					</Button>
				</div>
			</div>
		</section>
	);
}

const styles = stylex.create({
	root: {
		position: "relative",
		height: "100%",
		overflow: "hidden",
		backgroundColor: color.background,
		color: color.textMain,
		fontFamily:
			"ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
		WebkitFontSmoothing: "antialiased",
	},
	bottomFade: {
		position: "absolute",
		insetInline: 0,
		bottom: 0,
		height: "50%",
		pointerEvents: "none",
	},
	introStack: {
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		textAlign: "center",
	},
	logoFrame: {
		display: "flex",
		width: "72px",
		height: "72px",
		alignItems: "center",
		justifyContent: "center",
		overflow: "hidden",
		marginBottom: "1.75rem",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._4,
		backgroundColor: color.backgroundRaised,
		boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.4)",
	},
	logo: {
		width: "72px",
		height: "72px",
		borderRadius: controlSize._4,
		objectFit: "cover",
	},
	heroTitle: {
		color: color.textMain,
		fontSize: "1.75rem",
		fontWeight: 600,
		letterSpacing: 0,
		lineHeight: 1.15,
	},
	heroText: {
		maxWidth: "28rem",
		marginTop: controlSize._4,
		color: color.textMuted,
		fontSize: "0.8125rem",
		fontWeight: font.weight_5,
		lineHeight: 1.85,
	},
	primaryActions: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		gap: controlSize._3,
		marginTop: controlSize._7,
	},
	skipButton: {
		marginTop: controlSize._5,
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
		fontSize: "0.6875rem",
		transitionProperty: "color",
		transitionDuration: "120ms",
	},
	stepPanel: {
		display: "flex",
		width: "520px",
		maxWidth: "100%",
		flexDirection: "column",
		paddingInline: controlSize._6,
	},
	projectPanel: {
		display: "flex",
		width: "540px",
		maxWidth: "100%",
		flexDirection: "column",
		paddingInline: controlSize._6,
	},
	centerText: {
		textAlign: "center",
	},
	stepTitle: {
		color: color.textMain,
		fontSize: "1.5rem",
		fontWeight: 600,
		letterSpacing: 0,
	},
	stepDescription: {
		maxWidth: "28rem",
		marginInline: "auto",
		marginTop: controlSize._3,
		color: color.textMuted,
		fontSize: font.size_3,
		lineHeight: 1.85,
	},
	inlineCodeText: {
		color: color.textSoft,
		fontFamily: "var(--font-diff)",
	},
	stepContent: {
		marginTop: controlSize._7,
	},
	loadingState: {
		display: "flex",
		height: "5rem",
		alignItems: "center",
		justifyContent: "center",
		color: color.textMuted,
		fontSize: font.size_3,
	},
	spinIcon: {
		marginRight: "0.625rem",
		animationName: stylex.keyframes({
			to: {
				transform: "rotate(360deg)",
			},
		}),
		animationDuration: "900ms",
		animationIterationCount: "infinite",
		animationTimingFunction: "linear",
	},
	accountList: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
	},
	accountRow: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._3,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._2,
		backgroundColor: color.backgroundRaised,
		padding: controlSize._3,
	},
	avatarFrame: {
		display: "flex",
		width: "2.5rem",
		height: "2.5rem",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		overflow: "hidden",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: "999px",
		backgroundColor: color.controlActive,
	},
	avatar: {
		width: "100%",
		height: "100%",
		objectFit: "cover",
	},
	mutedIcon: {
		color: color.textMuted,
	},
	shrink: {
		flexShrink: 0,
	},
	rowText: {
		minWidth: 0,
		flex: 1,
	},
	accountName: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontSize: "0.8125rem",
		fontWeight: font.weight_5,
	},
	accountMeta: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: "0.6875rem",
	},
	noticeCard: {
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._2,
		backgroundColor: color.backgroundRaised,
		padding: controlSize._5,
		textAlign: "center",
	},
	noticeIconBox: {
		display: "flex",
		width: "2.5rem",
		height: "2.5rem",
		alignItems: "center",
		justifyContent: "center",
		marginInline: "auto",
		marginBottom: controlSize._4,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._2,
		backgroundColor: color.background,
		color: color.textMuted,
	},
	noticeTitle: {
		color: color.textMain,
		fontSize: font.size_3,
		fontWeight: font.weight_5,
	},
	noticeText: {
		marginTop: controlSize._1,
		color: color.textMuted,
		fontSize: "0.6875rem",
	},
	noticeActions: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		gap: controlSize._2,
		marginTop: controlSize._4,
	},
	actionCards: {
		display: "grid",
		gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
		gap: controlSize._3,
		marginTop: controlSize._7,
	},
	projectActionCard: {
		display: "flex",
		cursor: "pointer",
		flexDirection: "column",
		alignItems: "flex-start",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._2,
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlActive,
		},
		padding: controlSize._4,
		textAlign: "left",
		transitionProperty: "background-color, opacity",
		transitionDuration: "120ms",
		":disabled": {
			cursor: "default",
			opacity: 0.7,
		},
	},
	projectActionIcon: {
		display: "flex",
		width: "2.5rem",
		height: "2.5rem",
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._2,
		backgroundColor: color.background,
		color: color.textSoft,
	},
	projectActionTitle: {
		marginTop: controlSize._4,
		color: color.textMain,
		fontSize: "0.8125rem",
		fontWeight: font.weight_5,
	},
	projectActionText: {
		marginTop: controlSize._1,
		color: color.textMuted,
		fontSize: "0.6875rem",
		lineHeight: 1.6,
	},
	projectListSection: {
		minHeight: 0,
		flex: 1,
		marginTop: controlSize._6,
	},
	listMeta: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		marginBottom: controlSize._2,
		color: color.textMuted,
		fontSize: "0.6875rem",
	},
	projectList: {
		maxHeight: "240px",
		overflowY: "auto",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._2,
		backgroundColor: color.backgroundRaised,
		scrollbarWidth: "none",
	},
	localFolderRow: {
		display: "flex",
		height: "2.5rem",
		alignItems: "center",
		gap: controlSize._2,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		paddingInline: controlSize._3,
	},
	repoRow: {
		display: "flex",
		width: "100%",
		alignItems: "center",
		gap: "0.625rem",
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
		textAlign: "left",
		transitionProperty: "background-color",
		transitionDuration: "120ms",
		backgroundColor: {
			default: "transparent",
			":hover": "rgba(255, 255, 255, 0.04)",
		},
	},
	repoRowSelected: {
		backgroundColor: "rgba(255, 255, 255, 0.05)",
	},
	repoCheck: {
		display: "flex",
		width: controlSize._4,
		height: controlSize._4,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: "0.25rem",
		backgroundColor: color.background,
		transitionProperty: "background-color, border-color, color",
		transitionDuration: "120ms",
	},
	repoCheckSelected: {
		borderColor: color.textMain,
		backgroundColor: color.textMain,
		color: color.background,
	},
	repoName: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontSize: "0.6875rem",
		fontWeight: font.weight_5,
	},
	repoDescription: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_2,
	},
	repoMeta: {
		display: "flex",
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._2,
	},
	repoLanguage: {
		color: color.textMuted,
		fontSize: font.size_2,
	},
	privatePill: {
		borderRadius: "0.25rem",
		backgroundColor: color.controlActive,
		color: color.textMuted,
		fontSize: font.size_1,
		paddingBlock: "0.125rem",
		paddingInline: controlSize._1,
	},
	projectEmpty: {
		display: "flex",
		height: "7rem",
		alignItems: "center",
		justifyContent: "center",
		color: color.textMuted,
		fontSize: "0.6875rem",
		lineHeight: 1.6,
		textAlign: "center",
	},
});
