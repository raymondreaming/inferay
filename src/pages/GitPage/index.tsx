import * as stylex from "@stylexjs/stylex";
import {
	lazy,
	type MouseEvent as ReactMouseEvent,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { DiffViewerBoundary } from "../../components/diff/DiffViewerBoundary.tsx";
import {
	ChangeFileSidebar,
	type SelectedFile,
} from "../../components/git/ChangeFileSidebar.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import {
	IconGitBranch,
	IconOpenAI,
	IconPanelLeft,
	IconPlus,
	IconRobot,
	IconTerminal,
	IconX,
} from "../../components/ui/Icons.tsx";
import type { AgentKind } from "../../features/agents/agents.ts";
import {
	savePendingSend,
	saveStoredInput,
} from "../../features/chat/chat-session-store.ts";
import {
	buildCommitMessage,
	buildRepoExplainPrompt,
	buildSummaryPrompt,
	type ChangeCheckpoint,
	checkpointKey,
	buildReviewPrompt as composeReviewPrompt,
	createChangeSignature,
} from "../../features/git/changes-workspace.ts";
import { useGitChangeActions } from "../../features/git/useGitChangeActions.ts";
import {
	summarizeHunkDiff,
	useGitDiff,
} from "../../features/git/useGitDiff.ts";
import { useGitStatus } from "../../features/git/useGitStatus.ts";
import {
	appendPaneToGroup,
	createGroupId,
	createTerminalPane,
	DEFAULT_FONT_FAMILY,
	DEFAULT_FONT_SIZE,
	DEFAULT_OPACITY,
	loadTerminalState,
	saveTerminalState,
} from "../../features/terminal/terminal-utils.ts";
import { hasCwd, lacksValue } from "../../lib/data.ts";
import { fetchJson, postJson } from "../../lib/fetch-json.ts";
import {
	isStagedChange,
	isUnstagedTrackedChange,
	isUntrackedChange,
	orderProjectGitFiles,
} from "../../lib/git-file-utils.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";
import {
	readStoredJson,
	writeStoredJson,
	writeStoredValue,
} from "../../lib/stored-json.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";
import { InlineDirectoryPicker } from "../Terminal/InlineDirectoryPicker.tsx";

const GitDiffView = lazy(() =>
	import("../Terminal/GitDiffView.tsx").then((m) => ({
		default: m.GitDiffView,
	}))
);

function persist(dirs: string[]) {
	writeStoredJson("git-watched-dirs", dirs);
}

function selectRepositoryPath(
	addRepo: (path: string) => void | Promise<void>,
	closePicker: () => void,
	path: string | null
): void {
	path ? void addRepo(path) : closePicker();
}

export function GitPage() {
	const navigate = useNavigate();
	const [dirs, setDirs] = useState<string[]>(() =>
		readStoredJson<string[]>("git-watched-dirs", [])
	);
	const [activeCwd, setActiveCwd] = useState<string | null>(null);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [pickerError, setPickerError] = useState<string | null>(null);
	const [actionBusy, setActionBusy] = useState<string | null>(null);
	const [fileViewMode, setFileViewMode] = useState<"path" | "tree">("path");
	const [openActionMenu, setOpenActionMenu] = useState<"repo" | "file" | null>(
		null
	);
	const [sidebarWidth, setSidebarWidth] = useState(280);
	const [sidebarVisible, setSidebarVisible] = useState(true);
	const sidebarDragRef = useRef<{ startX: number; startWidth: number } | null>(
		null
	);
	const { projects, refetch, applyOptimistic } = useGitStatus(dirs);
	const {
		diff,
		request: diffReq,
		loading: diffLoading,
		loadDiff,
		clear: clearDiff,
	} = useGitDiff();
	const selectedDiffStats = useMemo(() => summarizeHunkDiff(diff), [diff]);
	const project = useMemo(() => {
		if (activeCwd) {
			const found = projects.find(hasCwd.bind(null, activeCwd));
			if (found) return found;
		}
		return projects[0] || null;
	}, [projects, activeCwd]);
	const [selFile, setSelFile] = useState<SelectedFile | null>(null);
	const [checkpointVersion, setCheckpointVersion] = useState(0);
	const prevCwd = useRef<string | null>(null);
	const hasAutoSelected = useRef(false);
	const allFiles = useMemo(
		(orderProjectGitFiles<SelectedFile>).bind(null, project),
		[project]
	);
	const selectFile = useCallback(
		(path: string, staged: boolean) => {
			if (!project) return;
			setSelFile({ path, staged });
			loadDiff({ cwd: project.cwd, file: path, staged });
		},
		[project?.cwd, loadDiff, project]
	);
	const handleSidebarDragStart = useCallback(
		(e: ReactMouseEvent) => {
			e.preventDefault();
			sidebarDragRef.current = {
				startX: e.clientX,
				startWidth: sidebarWidth,
			};

			const handleMouseMove = (event: MouseEvent) => {
				if (!sidebarDragRef.current) return;
				const delta = sidebarDragRef.current.startX - event.clientX;
				setSidebarWidth(
					Math.min(
						420,
						Math.max(180, sidebarDragRef.current.startWidth + delta)
					)
				);
			};

			const handleMouseUp = () => {
				sidebarDragRef.current = null;
				document.removeEventListener("mousemove", handleMouseMove);
				document.removeEventListener("mouseup", handleMouseUp);
			};

			document.addEventListener("mousemove", handleMouseMove);
			document.addEventListener("mouseup", handleMouseUp);
		},
		[sidebarWidth]
	);
	useEffect(() => {
		if (!project || project.files.length === 0) return;
		const cwdChanged = project.cwd !== prevCwd.current;
		if (cwdChanged) {
			hasAutoSelected.current = false;
			prevCwd.current = project.cwd;
		}
		if (hasAutoSelected.current) return;
		hasAutoSelected.current = true;
		const f = project.files[0]!;
		selectFile(f.path, f.staged);
	}, [project, selectFile]);
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement)?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
			if (!project || allFiles.length === 0) return;
			if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

			e.preventDefault();
			const currentIdx = selFile
				? allFiles.findIndex(
						(f) => f.path === selFile.path && f.staged === selFile.staged
					)
				: -1;

			let nextIdx: number;
			if (e.key === "ArrowDown") {
				nextIdx = currentIdx >= allFiles.length - 1 ? 0 : currentIdx + 1;
			} else {
				nextIdx = currentIdx <= 0 ? allFiles.length - 1 : currentIdx - 1;
			}

			const next = allFiles[nextIdx]!;
			selectFile(next.path, next.staged);
		};
		return listenWindowEvent("keydown", handler);
	}, [project, allFiles, selFile, selectFile]);

	const switchRepo = useCallback(
		(cwd: string) => {
			prevCwd.current = null;
			hasAutoSelected.current = false;
			setActiveCwd(cwd);
			setSelFile(null);
			clearDiff();
			setPickerOpen(false);
			setPickerError(null);
		},
		[clearDiff]
	);

	const addRepo = useCallback(
		async (dir: string) => {
			if (!dir || dirs.includes(dir)) return;
			setPickerError(null);
			try {
				await fetchJson(`/api/git/status?cwd=${encodeURIComponent(dir)}`);
			} catch {
				setPickerError("Not a git repository");
				return;
			}
			const next = [...dirs, dir];
			setDirs(next);
			persist(next);
			setPickerOpen(false);
			setPickerError(null);
			prevCwd.current = null;
			setActiveCwd(dir);
		},
		[dirs]
	);

	const removeRepo = useCallback(
		(cwd: string) => {
			const next = dirs.filter(lacksValue.bind(null, cwd));
			setDirs(next);
			persist(next);
			if (activeCwd === cwd) {
				prevCwd.current = null;
				setActiveCwd(next[0] || null);
			}
			setSelFile(null);
			clearDiff();
		},
		[dirs, activeCwd, clearDiff]
	);

	const closePicker = useCallback(() => {
		setPickerOpen(false);
		setPickerError(null);
	}, []);

	const staged = project?.files.filter(isStagedChange) || [];
	const modified = project?.files.filter(isUnstagedTrackedChange) || [];
	const untracked = project?.files.filter(isUntrackedChange) || [];

	const {
		commit: handleCommit,
		commitMessage,
		setCommitMessage,
		isCommitting,
		amendMode,
		setAmendMode,
		stageFile,
		unstageFile,
		stageAll,
		unstageAll,
	} = useGitChangeActions({
		cwd: project?.cwd,
		applyOptimistic,
		refetchStatus: refetch,
	});

	const changeSignature = useMemo(
		() => (project ? createChangeSignature(project.files) : ""),
		[project]
	);
	const latestCheckpoint = useMemo(() => {
		if (!project) return null;
		void checkpointVersion;
		return readStoredJson<ChangeCheckpoint | null>(
			checkpointKey(project.cwd),
			null
		);
	}, [project, checkpointVersion]);
	const dirtySinceCheckpoint = Boolean(
		project &&
		latestCheckpoint &&
		latestCheckpoint.signature !== changeSignature
	);
	const refreshProject = useCallback(async () => {
		setActionBusy("refresh");
		try {
			await refetch();
			if (project && selFile) {
				loadDiff({
					cwd: project.cwd,
					file: selFile.path,
					staged: selFile.staged,
				});
			}
		} finally {
			setActionBusy(null);
		}
	}, [refetch, project, selFile, loadDiff]);

	const openPane = useCallback(
		(agentKind: AgentKind, initialInput?: string, autoSend = false) => {
			if (!project) return null;
			const existing = loadTerminalState();
			const groups = existing?.groups ?? [
				{
					id: createGroupId(),
					name: "Default",
					panes: [],
					selectedPaneId: null,
					columns: 2,
					rows: 1,
				},
			];
			const selectedGroupId =
				existing?.selectedGroupId ?? groups[0]?.id ?? null;
			if (!selectedGroupId) return null;
			const pane = createTerminalPane(agentKind, project.cwd);
			if (initialInput && agentKind !== "terminal") {
				if (autoSend) {
					savePendingSend(pane.id, initialInput);
				} else {
					saveStoredInput(pane.id, initialInput);
				}
			}
			saveTerminalState({
				groups: groups.map(appendPaneToGroup.bind(null, selectedGroupId, pane)),
				selectedGroupId,
				themeId: existing?.themeId ?? ("default" as const),
				fontSize: existing?.fontSize ?? DEFAULT_FONT_SIZE,
				fontFamily: existing?.fontFamily ?? DEFAULT_FONT_FAMILY,
				opacity: existing?.opacity ?? DEFAULT_OPACITY,
			});
			window.dispatchEvent(new Event("terminal-shell-change"));
			navigate("/terminal");
			return pane;
		},
		[navigate, project]
	);

	const openEditor = useCallback(() => {
		if (!project) return;
		const pane = openPane("terminal");
		if (pane) {
			writeStoredValue("terminal-main-view", "editor");
			writeStoredValue("editor-selected-pane", pane.id);
			window.dispatchEvent(new Event("terminal-shell-change"));
		}
	}, [openPane, project]);

	const openNativePath = useCallback(async (path: string, reveal = false) => {
		setActionBusy(reveal ? "reveal" : "open-path");
		try {
			await postJson<{ ok: boolean }>("/api/native/open-path", {
				path,
				reveal,
			});
		} catch {
		} finally {
			setActionBusy(null);
		}
	}, []);

	const copyText = useCallback(async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
		} catch {}
	}, []);

	const loadReviewPrompt = useCallback(async () => {
		if (!project) return;
		const diffs = await Promise.all(
			project.files.map(async (file) => {
				const result = await fetchJson<{ diff: string }>(
					`/api/git/diff?cwd=${encodeURIComponent(project.cwd)}&file=${encodeURIComponent(file.path)}&staged=${file.staged}`
				);
				return { file, diff: result.diff };
			})
		);
		return composeReviewPrompt(project, diffs);
	}, [project]);

	const copyReviewPrompt = useCallback(async () => {
		setActionBusy("review-prompt");
		try {
			const prompt = await loadReviewPrompt();
			if (!prompt) return;
			await copyText(prompt);
		} catch {
		} finally {
			setActionBusy(null);
		}
	}, [loadReviewPrompt, copyText]);

	const summarizeChanges = useCallback(async () => {
		if (!project) return;
		setActionBusy("summary");
		try {
			const prompt = await loadReviewPrompt();
			if (!prompt) return;
			const summaryPrompt = buildSummaryPrompt(project, prompt);
			openPane("claude", summaryPrompt, true);
		} catch {
		} finally {
			setActionBusy(null);
		}
	}, [loadReviewPrompt, openPane, project]);

	const openReviewPane = useCallback(
		async (agentKind: "claude" | "codex", autoSend = false) => {
			setActionBusy(`review:${agentKind}`);
			try {
				const prompt = await loadReviewPrompt();
				if (!prompt) return;
				openPane(agentKind, prompt, autoSend);
			} catch {
			} finally {
				setActionBusy(null);
			}
		},
		[loadReviewPrompt, openPane]
	);

	const copyCommitMessage = useCallback(async () => {
		if (!project) return;
		await copyText(buildCommitMessage(project));
	}, [project, copyText]);

	const createCheckpoint = useCallback(() => {
		if (!project) return;
		const checkpoint: ChangeCheckpoint = {
			id: crypto.randomUUID().slice(0, 8),
			cwd: project.cwd,
			timestamp: Date.now(),
			signature: changeSignature,
		};
		writeStoredJson(checkpointKey(project.cwd), checkpoint);
		setCheckpointVersion((version) => version + 1);
	}, [project, changeSignature]);

	const explainRepo = useCallback(() => {
		if (!project) return;
		openPane("claude", buildRepoExplainPrompt(project), true);
	}, [openPane, project]);

	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				target?.tagName === "INPUT" ||
				target?.tagName === "TEXTAREA" ||
				target?.tagName === "SELECT" ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey
			) {
				return;
			}
			if (event.key === "r") {
				event.preventDefault();
				void refreshProject();
			} else if (event.key === "R") {
				event.preventDefault();
				void openReviewPane("claude", true);
			} else if (event.key === "c") {
				event.preventDefault();
				void copyCommitMessage();
			}
		};
		return listenWindowEvent("keydown", handler);
	}, [copyCommitMessage, openReviewPane, refreshProject]);

	if (dirs.length === 0 && !pickerOpen) {
		return (
			<div {...stylex.props(styles.centerPage)}>
				<div {...stylex.props(styles.centerStack)}>
					<div {...stylex.props(styles.emptyIconBox)}>
						<IconGitBranch size={24} {...stylex.props(styles.mutedIcon)} />
					</div>
					<p {...stylex.props(styles.emptyTitle)}>No repositories</p>
					<p {...stylex.props(styles.emptyText)}>
						Add a local git repo to get started
					</p>
					<Button
						type="button"
						onClick={setPickerOpen.bind(null, true)}
						variant="secondary"
						size="sm"
					>
						Add Repository
					</Button>
				</div>
			</div>
		);
	}

	if (dirs.length === 0 && pickerOpen) {
		return (
			<div {...stylex.props(styles.centerPage)}>
				<div>
					{pickerError && (
						<div {...stylex.props(styles.errorNotice)}>{pickerError}</div>
					)}
					<InlineDirectoryPicker
						onSelect={selectRepositoryPath.bind(null, addRepo, closePicker)}
						onCancel={closePicker}
					/>
				</div>
			</div>
		);
	}

	return (
		<div {...stylex.props(styles.root)}>
			<div {...stylex.props(styles.topBar)}>
				<div {...stylex.props(styles.repoControls)}>
					<label className="sr-only" htmlFor="git-repo-select">
						Repository
					</label>
					<select
						id="git-repo-select"
						value={project?.cwd ?? ""}
						onChange={(event) => switchRepo(event.target.value)}
						{...stylex.props(styles.repoSelect)}
					>
						{projects.map((repo) => {
							const count =
								repo.stagedCount + repo.unstagedCount + repo.untrackedCount;
							return (
								<option key={repo.cwd} value={repo.cwd}>
									{repo.name}
									{count ? ` (${count})` : ""}
								</option>
							);
						})}
					</select>
					{project && dirs.length > 1 && (
						<IconButton
							type="button"
							title="Remove repository"
							onClick={() => removeRepo(project.cwd)}
							variant="ghost"
							size="xs"
						>
							<IconX size={10} />
						</IconButton>
					)}
				</div>
				<IconButton
					type="button"
					onClick={setPickerOpen.bind(null, true)}
					variant="subtle"
					size="xs"
					className={stylex.props(styles.addRepoButton).className}
					title="Add repository"
				>
					<IconPlus size={9} />
				</IconButton>
				{project && (
					<>
						<div {...stylex.props(styles.divider)} />
						<IconGitBranch
							size={10}
							{...stylex.props(styles.mutedIcon, styles.shrink)}
						/>
						<span {...stylex.props(styles.branchText)}>{project.branch}</span>
						{project.ahead > 0 && (
							<span {...stylex.props(styles.addedText)}>+{project.ahead}</span>
						)}
						{project.behind > 0 && (
							<span {...stylex.props(styles.deletedText)}>
								-{project.behind}
							</span>
						)}
						{dirtySinceCheckpoint && (
							<span {...stylex.props(styles.dirtyPill)}>dirty</span>
						)}
					</>
				)}
				<span {...stylex.props(styles.spacer)} />
				{project && (
					<div {...stylex.props(styles.actionGroup)}>
						<ActionButton
							label="Review"
							variant="primary"
							disabled={
								project.files.length === 0 || actionBusy?.startsWith("review:")
							}
							onClick={() => void openReviewPane("claude", true)}
						/>
						<ActionButton
							label="Summary"
							disabled={project.files.length === 0 || actionBusy === "summary"}
							onClick={() => void summarizeChanges()}
						/>
						<div {...stylex.props(styles.divider)} />
						<IconButton
							type="button"
							title="Open terminal here"
							onClick={openPane.bind(null, "terminal", undefined, undefined)}
							variant="ghost"
							size="xs"
						>
							<IconTerminal size={10} />
						</IconButton>
						<IconButton
							type="button"
							title="Open Claude here"
							onClick={openPane.bind(null, "claude", undefined, undefined)}
							variant="ghost"
							size="xs"
						>
							<IconRobot size={10} />
						</IconButton>
						<IconButton
							type="button"
							title="Open Codex here"
							onClick={openPane.bind(null, "codex", undefined, undefined)}
							variant="ghost"
							size="xs"
						>
							<IconOpenAI size={10} />
						</IconButton>
						<ActionMenu
							label="More"
							open={openActionMenu === "repo"}
							onToggle={() =>
								setOpenActionMenu((value) => (value === "repo" ? null : "repo"))
							}
							items={[
								{
									label: "Refresh",
									disabled: actionBusy === "refresh",
									onSelect: () => void refreshProject(),
								},
								{
									label: "Copy branch",
									onSelect: () =>
										project.branch && void copyText(project.branch),
								},
								{ label: "Open in Editor", onSelect: openEditor },
								{
									label: "Open in Finder",
									disabled: actionBusy === "reveal",
									onSelect: () => void openNativePath(project.cwd, false),
								},
								{
									label: "Draft review",
									disabled:
										project.files.length === 0 ||
										actionBusy?.startsWith("review:"),
									onSelect: () => void openReviewPane("claude"),
								},
								{
									label: "Copy review prompt",
									disabled:
										project.files.length === 0 ||
										actionBusy === "review-prompt",
									onSelect: () => void copyReviewPrompt(),
								},
								{
									label: "Copy commit message",
									disabled: project.files.length === 0,
									onSelect: () => void copyCommitMessage(),
								},
								{ label: "Create checkpoint", onSelect: createCheckpoint },
							]}
						/>
					</div>
				)}
			</div>

			<div {...stylex.props(styles.content)}>
				<div {...stylex.props(styles.mainPane)}>
					{pickerOpen ? (
						<div {...stylex.props(styles.centerPage)}>
							<div>
								{pickerError && (
									<div {...stylex.props(styles.errorNotice)}>{pickerError}</div>
								)}
								<InlineDirectoryPicker
									onSelect={selectRepositoryPath.bind(
										null,
										addRepo,
										closePicker
									)}
									onCancel={closePicker}
								/>
							</div>
						</div>
					) : diffLoading ? (
						<div {...stylex.props(styles.centerPage)}>
							<div {...stylex.props(styles.loadingRow)}>
								<div {...stylex.props(styles.spinner)} />
								<span {...stylex.props(styles.loadingText)}>Loading...</span>
							</div>
						</div>
					) : diff && diffReq ? (
						<DiffViewerBoundary
							resetKey={`${diffReq.cwd}:${diffReq.staged ? "staged" : "unstaged"}:${diffReq.file}`}
						>
							<Suspense
								fallback={
									<div {...stylex.props(styles.centerPage)}>
										<div {...stylex.props(styles.loadingRow)}>
											<div {...stylex.props(styles.spinner)} />
											<span {...stylex.props(styles.loadingText)}>
												Loading diff viewer...
											</span>
										</div>
									</div>
								}
							>
								<GitDiffView
									diff={diff}
									filePath={diffReq.file}
									staged={diffReq.staged}
									loading={false}
									onClose={() => {
										clearDiff();
										setSelFile(null);
									}}
								/>
							</Suspense>
						</DiffViewerBoundary>
					) : (
						<div {...stylex.props(styles.centerPage, styles.centerPad)}>
							<div {...stylex.props(styles.emptyWorktree)}>
								<p {...stylex.props(styles.emptyMainText)}>
									{project
										? project.files.length === 0
											? "No worktree changes"
											: "Select a file to view changes"
										: "Add a repository"}
								</p>
								{project && (
									<div {...stylex.props(styles.emptyActions)}>
										<ActionButton
											label="Open terminal here"
											onClick={openPane.bind(
												null,
												"terminal",
												undefined,
												undefined
											)}
										/>
										<ActionButton
											label="Open Claude here"
											onClick={openPane.bind(
												null,
												"claude",
												undefined,
												undefined
											)}
										/>
										<ActionButton
											label="Open Codex here"
											onClick={openPane.bind(
												null,
												"codex",
												undefined,
												undefined
											)}
										/>
										<ActionButton label="Explain repo" onClick={explainRepo} />
									</div>
								)}
							</div>
						</div>
					)}
				</div>

				{project && sidebarVisible && (
					<div
						{...stylex.props(styles.fileSidebar)}
						style={{ width: sidebarWidth }}
					>
						<div
							{...stylex.props(styles.sidebarResize)}
							onMouseDown={handleSidebarDragStart}
						/>
						<ChangeFileSidebar
							cwd={project.cwd}
							fileViewMode={fileViewMode}
							onFileViewModeChange={setFileViewMode}
							mainViewMode="diff"
							modified={modified}
							untracked={untracked}
							staged={staged}
							selectedFile={selFile}
							selectedDiffStats={selectedDiffStats}
							onSelectFile={(file) => selectFile(file.path, file.staged)}
							onStageFile={stageFile}
							onUnstageFile={unstageFile}
							onStageAll={stageAll}
							onUnstageAll={unstageAll}
							hasProject={!!project}
							selectedCommitHash={null}
							commitDetailsLoading={false}
							commitDetails={null}
							files={project.files}
							branch={project.branch}
							commitMessage={commitMessage}
							onCommitMessageChange={setCommitMessage}
							onCommit={handleCommit}
							isCommitting={isCommitting}
							amendMode={amendMode}
							onAmendModeChange={setAmendMode}
							onCollapse={() => setSidebarVisible(false)}
						/>
					</div>
				)}
				{project && !sidebarVisible && (
					<button
						type="button"
						onClick={() => setSidebarVisible(true)}
						title="Show files sidebar"
						{...stylex.props(styles.sidebarRestore)}
					>
						<IconPanelLeft size={12} />
					</button>
				)}
			</div>
		</div>
	);
}

function ActionButton({
	label,
	disabled,
	onClick,
	variant = "secondary",
}: {
	label: string;
	disabled?: boolean;
	onClick: () => void;
	variant?: "primary" | "secondary";
}) {
	return (
		<Button
			type="button"
			disabled={disabled}
			onClick={onClick}
			variant={variant === "primary" ? "primary" : "secondary"}
			size="sm"
			className={
				stylex.props(
					styles.actionButton,
					variant === "primary" && styles.primaryActionButton
				).className
			}
		>
			{label}
		</Button>
	);
}

function ActionMenu({
	label,
	open,
	onToggle,
	items,
}: {
	label: string;
	open: boolean;
	onToggle: () => void;
	items: {
		label: string;
		disabled?: boolean;
		onSelect: () => void;
	}[];
}) {
	return (
		<div {...stylex.props(styles.menuRoot)}>
			<ActionButton label={label} onClick={onToggle} />
			{open && (
				<div {...stylex.props(styles.menu)}>
					{items.map((item) => (
						<button
							key={item.label}
							type="button"
							disabled={item.disabled}
							onClick={() => {
								onToggle();
								item.onSelect();
							}}
							{...stylex.props(styles.menuItem)}
						>
							{item.label}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

const styles = stylex.create({
	root: {
		display: "flex",
		height: "100%",
		flexDirection: "column",
		backgroundColor: color.background,
	},
	centerPage: {
		display: "flex",
		height: "100%",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: color.background,
	},
	centerPad: {
		paddingInline: controlSize._6,
	},
	centerStack: {
		textAlign: "center",
	},
	emptyIconBox: {
		display: "flex",
		width: "3.5rem",
		height: "3.5rem",
		alignItems: "center",
		justifyContent: "center",
		marginInline: "auto",
		marginBottom: controlSize._4,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._3,
		backgroundColor: color.backgroundRaised,
	},
	mutedIcon: {
		color: color.textMuted,
	},
	shrink: {
		flexShrink: 0,
	},
	emptyTitle: {
		marginBottom: controlSize._1,
		color: color.textMain,
		fontSize: font.size_3,
	},
	emptyText: {
		marginBottom: controlSize._4,
		color: color.textMuted,
		fontSize: font.size_2,
	},
	errorNotice: {
		marginBottom: controlSize._2,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: "rgba(248, 81, 73, 0.2)",
		borderRadius: controlSize._2,
		backgroundColor: "rgba(248, 81, 73, 0.05)",
		color: "var(--color-git-deleted)",
		fontSize: font.size_2,
		paddingBlock: "0.375rem",
		paddingInline: controlSize._3,
	},
	topBar: {
		display: "flex",
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._2,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		paddingBlock: "0.375rem",
		paddingInline: controlSize._3,
	},
	repoControls: {
		display: "flex",
		minWidth: 0,
		alignItems: "center",
		gap: controlSize._2,
	},
	repoSelect: {
		height: controlSize._6,
		minWidth: "160px",
		maxWidth: "240px",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: {
			default: color.border,
			":focus": color.textMuted,
		},
		borderRadius: "0.375rem",
		backgroundColor: color.backgroundRaised,
		color: color.textSoft,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		outline: "none",
		paddingInline: controlSize._2,
		transitionProperty: "background-color, border-color",
		transitionDuration: "120ms",
		":hover": {
			backgroundColor: color.controlHover,
		},
	},
	addRepoButton: {
		width: controlSize._5,
		height: controlSize._5,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		backgroundColor: color.backgroundRaised,
	},
	divider: {
		width: 1,
		height: font.size_3,
		backgroundColor: "rgba(255, 255, 255, 0.06)",
	},
	branchText: {
		color: color.textMuted,
		fontSize: font.size_1,
	},
	addedText: {
		color: "var(--color-git-added)",
		fontSize: "0.5rem",
	},
	deletedText: {
		color: "var(--color-git-deleted)",
		fontSize: "0.5rem",
	},
	dirtyPill: {
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: "rgba(234, 179, 8, 0.3)",
		borderRadius: "0.25rem",
		backgroundColor: "rgba(234, 179, 8, 0.1)",
		color: "var(--color-git-modified)",
		fontSize: "0.5rem",
		paddingBlock: "0.125rem",
		paddingInline: controlSize._1,
	},
	spacer: {
		flex: 1,
	},
	actionGroup: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._1,
	},
	content: {
		display: "flex",
		minHeight: 0,
		flex: 1,
		overflow: "hidden",
	},
	mainPane: {
		display: "flex",
		minWidth: 0,
		flex: 1,
		flexDirection: "column",
		overflow: "hidden",
	},
	loadingRow: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
	},
	spinner: {
		width: font.size_3,
		height: font.size_3,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.textMuted,
		borderTopColor: "transparent",
		borderRadius: "999px",
		animationName: stylex.keyframes({
			to: {
				transform: "rotate(360deg)",
			},
		}),
		animationDuration: "800ms",
		animationTimingFunction: "linear",
		animationIterationCount: "infinite",
	},
	loadingText: {
		color: color.textMuted,
		fontSize: "0.6875rem",
	},
	emptyWorktree: {
		display: "flex",
		maxWidth: "28rem",
		flexDirection: "column",
		alignItems: "center",
		gap: controlSize._3,
		textAlign: "center",
	},
	emptyMainText: {
		color: color.textMuted,
		fontSize: font.size_3,
	},
	emptyActions: {
		display: "flex",
		flexWrap: "wrap",
		alignItems: "center",
		justifyContent: "center",
		gap: "0.375rem",
	},
	fileSidebar: {
		display: "flex",
		flexShrink: 0,
		flexDirection: "row",
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
		backgroundColor: color.background,
	},
	sidebarResize: {
		width: controlSize._1,
		flexShrink: 0,
		cursor: "ew-resize",
		backgroundColor: {
			default: "transparent",
			":hover": color.controlActive,
		},
		transitionProperty: "background-color",
		transitionDuration: "120ms",
	},
	sidebarRestore: {
		alignItems: "center",
		backgroundColor: {
			default: color.background,
			":hover": color.controlActive,
		},
		borderLeftColor: color.border,
		borderLeftStyle: "solid",
		borderLeftWidth: 1,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		cursor: "pointer",
		display: "flex",
		flexShrink: 0,
		justifyContent: "center",
		transitionProperty: "background-color, color",
		transitionDuration: "120ms",
		width: controlSize._8,
	},
	actionButton: {
		height: controlSize._5,
		borderRadius: "0.375rem",
		fontSize: "0.5rem",
		paddingInline: "0.375rem",
	},
	primaryActionButton: {
		borderColor: "rgba(29, 185, 84, 0.35)",
		backgroundColor: "rgba(29, 185, 84, 0.12)",
		color: color.textSoft,
		":hover": {
			backgroundColor: "rgba(29, 185, 84, 0.18)",
		},
	},
	menuRoot: {
		position: "relative",
	},
	menu: {
		position: "absolute",
		right: 0,
		top: controlSize._6,
		zIndex: 30,
		minWidth: "9rem",
		overflow: "hidden",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: "0.375rem",
		backgroundColor: color.backgroundRaised,
		boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.8)",
	},
	menuItem: {
		display: "flex",
		width: "100%",
		height: controlSize._7,
		alignItems: "center",
		color: color.textMuted,
		fontSize: font.size_1,
		paddingInline: "0.625rem",
		textAlign: "left",
		transitionProperty: "background-color, color, opacity",
		transitionDuration: "120ms",
		backgroundColor: {
			default: "transparent",
			":hover": color.controlHover,
		},
		":hover": {
			color: color.textSoft,
		},
		":disabled": {
			opacity: 0.3,
			pointerEvents: "none",
		},
	},
});
