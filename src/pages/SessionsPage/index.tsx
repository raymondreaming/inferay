import * as stylex from "@stylexjs/stylex";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	IconFilePlus,
	IconMessageCircle,
	IconRefreshCw,
	IconTrash,
} from "../../components/ui/Icons.tsx";
import {
	WorkspaceContent,
	WorkspaceEmptyState,
	WorkspaceIconButton,
	WorkspacePage,
	WorkspaceSearch,
	WorkspaceSegmentButton,
	WorkspaceSegmentedControl,
	WorkspaceToolbar,
	WorkspaceToolbarSpacer,
} from "../../components/ui/WorkspacePage.tsx";
import { getAgentIcon } from "../../features/agents/agent-ui.tsx";
import { getAgentDefinition } from "../../features/agents/agents.ts";
import {
	createDocumentArtifact,
	loadDocumentArtifacts,
} from "../../features/artifacts/artifact-workspace-store.ts";
import type {
	ChatMessage,
	CheckpointInfo,
} from "../../features/chat/agent-chat-shared.ts";
import {
	clearAgentChatMessages,
	loadSessionLibrary,
	loadStoredCheckpoints,
	loadStoredLoadingState,
	loadStoredMessages,
	type StoredChatSession,
} from "../../features/chat/chat-session-store.ts";
import { dispatchComposerContextBlock } from "../../features/chat/composer-context.ts";
import {
	buildSessionDetailModel,
	type SessionDetailModel,
	type SessionLifecycleStatus,
	sessionContextBlock,
} from "../../features/chat/session-detail.ts";
import { saveSessionAsQuickAction } from "../../features/quick-actions/quick-actions-store.ts";
import {
	type AgentKind,
	DEFAULT_FONT_FAMILY,
	DEFAULT_FONT_SIZE,
	DEFAULT_OPACITY,
	type GroupId,
	getInitialGroups,
	getPaneTitle,
	loadTerminalState,
	type PaneId,
	saveTerminalState,
	type TerminalGroupModel,
	type TerminalPaneModel,
} from "../../features/terminal/terminal-utils.ts";
import { DEFAULT_APP_ROUTE } from "../../lib/app-navigation.tsx";
import {
	loadAppThemeId,
	mapAppThemeToTerminalTheme,
} from "../../lib/app-theme.ts";
import { hasId } from "../../lib/data.ts";
import { basename, formatRelativeTime } from "../../lib/format.ts";
import { setInputValue } from "../../lib/react-events.ts";
import { writeStoredValue } from "../../lib/stored-json.ts";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
} from "../../tokens.stylex.ts";

function refreshSessions(): StoredChatSession[] {
	return loadSessionLibrary();
}

type SessionFilter = "all" | SessionLifecycleStatus;

const SESSION_FILTERS: { id: SessionFilter; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "running", label: "Running" },
	{ id: "review", label: "Review" },
	{ id: "ready", label: "Ready" },
];

function loadSessionDetail(session: StoredChatSession): SessionDetailModel {
	return buildSessionDetailModel(
		session,
		loadStoredMessages<ChatMessage>(session.paneId),
		loadStoredCheckpoints<CheckpointInfo>(session.paneId),
		loadStoredLoadingState(session.paneId),
		loadDocumentArtifacts()
	);
}

function restoreSession(session: StoredChatSession): void {
	const state = loadTerminalState();
	const groups = (state?.groups ?? getInitialGroups()).map((group) => ({
		...group,
		panes: [...group.panes],
	}));
	const existingGroup = groups.find((group) =>
		group.panes.some(hasId.bind(null, session.paneId))
	);

	if (existingGroup) {
		existingGroup.selectedPaneId = session.paneId as PaneId;
		saveTerminalState({
			groups,
			selectedGroupId: existingGroup.id,
			themeId: state?.themeId ?? mapAppThemeToTerminalTheme(loadAppThemeId()),
			fontSize: state?.fontSize ?? DEFAULT_FONT_SIZE,
			fontFamily: state?.fontFamily ?? DEFAULT_FONT_FAMILY,
			opacity: state?.opacity ?? DEFAULT_OPACITY,
		});
		return;
	}

	const selectedGroupId = state?.selectedGroupId ?? groups[0]?.id ?? null;
	const selectedGroup =
		groups.find(hasId.bind(null, selectedGroupId)) ?? groups[0] ?? null;
	if (!selectedGroup) return;

	const agentKind = session.agentKind as AgentKind;
	const pane: TerminalPaneModel = {
		id: session.paneId as PaneId,
		title:
			session.summary ??
			getPaneTitle(agentKind, session.cwd ?? undefined) ??
			getAgentDefinition(agentKind).paneTitle,
		agentKind,
		isClaude: agentKind === "claude",
		paneType: agentKind,
		cwd: session.cwd ?? undefined,
		pendingCwd: false,
		referencePaths: session.referencePaths,
		summary: session.summary ?? undefined,
	};
	selectedGroup.panes.unshift(pane);
	selectedGroup.selectedPaneId = pane.id;

	saveTerminalState({
		groups: groups.map(
			(group): TerminalGroupModel =>
				group.id === selectedGroup.id ? selectedGroup : group
		),
		selectedGroupId: selectedGroup.id as GroupId,
		themeId: state?.themeId ?? mapAppThemeToTerminalTheme(loadAppThemeId()),
		fontSize: state?.fontSize ?? DEFAULT_FONT_SIZE,
		fontFamily: state?.fontFamily ?? DEFAULT_FONT_FAMILY,
		opacity: state?.opacity ?? DEFAULT_OPACITY,
	});
}

function deleteSession(session: StoredChatSession): void {
	if (!confirm(`Remove "${session.summary || session.paneId}" from history?`)) {
		return;
	}
	clearAgentChatMessages(session.paneId);
}

export function SessionsPage() {
	const navigate = useNavigate();
	const [sessions, setSessions] = useState(refreshSessions);
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<SessionFilter>("all");
	const [artifactVersion, setArtifactVersion] = useState(0);
	const [detailStatus, setDetailStatus] = useState<string | null>(null);
	const [selectedPaneId, setSelectedPaneId] = useState<string | null>(
		() => sessions[0]?.paneId ?? null
	);

	void artifactVersion;
	const documentArtifacts = loadDocumentArtifacts();
	const detailByPaneId = useMemo(() => {
		return new Map(
			sessions.map((session) => [
				session.paneId,
				buildSessionDetailModel(
					session,
					loadStoredMessages<ChatMessage>(session.paneId),
					loadStoredCheckpoints<CheckpointInfo>(session.paneId),
					loadStoredLoadingState(session.paneId),
					documentArtifacts
				),
			])
		);
	}, [documentArtifacts, sessions]);
	const statusCounts = useMemo(() => {
		const counts: Record<SessionLifecycleStatus, number> = {
			running: 0,
			review: 0,
			ready: 0,
			empty: 0,
		};
		for (const detail of detailByPaneId.values()) counts[detail.status] += 1;
		return counts;
	}, [detailByPaneId]);
	const visibleSessions = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return sessions.filter((session) => {
			const detail = detailByPaneId.get(session.paneId);
			if (filter !== "all" && detail?.status !== filter) return false;
			if (!needle) return true;
			return [
				session.summary,
				session.lastMessage,
				session.cwd,
				session.agentKind,
				session.model,
				session.sessionId,
				detail?.statusLabel,
				...(detail?.artifacts.map((artifact) => artifact.title) ?? []),
			]
				.filter(Boolean)
				.join(" ")
				.toLowerCase()
				.includes(needle);
		});
	}, [detailByPaneId, filter, query, sessions]);

	const openSession = useCallback(
		(session: StoredChatSession) => {
			restoreSession(session);
			writeStoredValue("terminal-main-view", "chat");
			window.dispatchEvent(new Event("terminal-shell-change"));
			navigate(DEFAULT_APP_ROUTE);
		},
		[navigate]
	);
	const injectSession = useCallback(
		(session: StoredChatSession) => {
			const detail =
				detailByPaneId.get(session.paneId) ?? loadSessionDetail(session);
			dispatchComposerContextBlock(sessionContextBlock(detail));
			writeStoredValue("terminal-main-view", "chat");
			window.dispatchEvent(new Event("terminal-shell-change"));
			setDetailStatus(null);
			navigate(DEFAULT_APP_ROUTE);
		},
		[detailByPaneId, navigate]
	);
	const saveSessionAction = useCallback(
		(session: StoredChatSession) => {
			const detail =
				detailByPaneId.get(session.paneId) ?? loadSessionDetail(session);
			const action = saveSessionAsQuickAction(session, detail);
			setDetailStatus(`Saved "${action.name}" as an automation piece.`);
		},
		[detailByPaneId]
	);

	const removeSession = useCallback((session: StoredChatSession) => {
		deleteSession(session);
		const next = refreshSessions();
		setSessions(next);
		setSelectedPaneId((current) =>
			current === session.paneId ? (next[0]?.paneId ?? null) : current
		);
	}, []);
	const selectedSession =
		visibleSessions.find((session) => session.paneId === selectedPaneId) ??
		visibleSessions[0] ??
		null;
	const saveSessionArtifact = useCallback((session: StoredChatSession) => {
		const messages = loadStoredMessages<ChatMessage>(session.paneId);
		const checkpoints = loadStoredCheckpoints<CheckpointInfo>(session.paneId);
		const detail = buildSessionDetailModel(session, messages, checkpoints);
		const artifact = createDocumentArtifact({
			title: detail.transcriptArtifact.title,
			subtitle: detail.transcriptArtifact.subtitle,
			content: detail.transcriptArtifact.content,
			sourcePaneId: session.paneId,
			sourceMessageId: null,
			sourceRole: "session-transcript",
			projectPath: session.cwd,
		});
		setArtifactVersion((version) => version + 1);
		setDetailStatus(`Saved "${artifact.title}" to Artifacts.`);
	}, []);

	return (
		<WorkspacePage>
			<WorkspaceToolbar>
				<WorkspaceSegmentedControl {...stylex.props(styles.toolbarFilters)}>
					{SESSION_FILTERS.map((item) => (
						<WorkspaceSegmentButton
							key={item.id}
							type="button"
							onClick={() => setFilter(item.id)}
							active={filter === item.id}
						>
							{item.label}
							{item.id !== "all" ? ` ${statusCounts[item.id]}` : ""}
						</WorkspaceSegmentButton>
					))}
				</WorkspaceSegmentedControl>
				<WorkspaceToolbarSpacer />
				<WorkspaceSearch
					value={query}
					onChange={setInputValue.bind(null, setQuery)}
					placeholder="Search sessions"
				/>
				<WorkspaceIconButton
					type="button"
					onClick={() => setSessions(refreshSessions())}
					title="Refresh sessions"
				>
					<IconRefreshCw size={12} />
				</WorkspaceIconButton>
			</WorkspaceToolbar>

			<WorkspaceContent>
				{visibleSessions.length === 0 ? (
					<WorkspaceEmptyState
						icon={<IconMessageCircle size={16} />}
						title="No retained sessions"
						description={
							query.trim()
								? "No saved chat history matches this search."
								: "Completed Claude and Codex conversations will appear here for restore, export, and handoff."
						}
					/>
				) : (
					<div {...stylex.props(styles.sessionGrid)}>
						<div {...stylex.props(styles.sessionList)}>
							{visibleSessions.map((session) => (
								<SessionRow
									key={session.paneId}
									session={session}
									detail={detailByPaneId.get(session.paneId)}
									active={selectedSession?.paneId === session.paneId}
									onSelect={() => setSelectedPaneId(session.paneId)}
									onOpen={() => openSession(session)}
									onDelete={() => removeSession(session)}
								/>
							))}
						</div>
						<SessionDetail
							session={selectedSession}
							detail={
								selectedSession
									? detailByPaneId.get(selectedSession.paneId)
									: undefined
							}
							onOpen={
								selectedSession ? () => openSession(selectedSession) : undefined
							}
							onInject={
								selectedSession
									? () => injectSession(selectedSession)
									: undefined
							}
							onSaveArtifact={
								selectedSession
									? () => saveSessionArtifact(selectedSession)
									: undefined
							}
							onSaveAction={
								selectedSession
									? () => saveSessionAction(selectedSession)
									: undefined
							}
							status={detailStatus}
						/>
					</div>
				)}
			</WorkspaceContent>
		</WorkspacePage>
	);
}

function SessionRow({
	session,
	detail,
	active,
	onSelect,
	onOpen,
	onDelete,
}: {
	session: StoredChatSession;
	detail?: SessionDetailModel;
	active: boolean;
	onSelect: () => void;
	onOpen: () => void;
	onDelete: () => void;
}) {
	const messages = loadStoredMessages<ChatMessage>(session.paneId);
	const title =
		session.summary ||
		session.lastMessage ||
		(session.cwd ? basename(session.cwd) : "Untitled session");
	const cwdLabel = session.cwd ? basename(session.cwd) : "No folder";
	const agentLabel = getAgentDefinition(session.agentKind as AgentKind).label;

	return (
		<article
			{...stylex.props(styles.sessionRow, active && styles.sessionRowActive)}
		>
			<button
				type="button"
				onClick={onSelect}
				{...stylex.props(styles.openArea)}
			>
				<span {...stylex.props(styles.agentIcon)}>
					{getAgentIcon(session.agentKind as AgentKind, 14)}
				</span>
				<span {...stylex.props(styles.sessionMain)}>
					<span {...stylex.props(styles.sessionTitle)}>{title}</span>
					<span {...stylex.props(styles.sessionMeta)}>
						<span
							{...stylex.props(
								styles.statusBadge,
								detail?.status === "running" && styles.statusRunning,
								detail?.status === "review" && styles.statusReview
							)}
						>
							{detail?.statusLabel ?? "Ready"}
						</span>
						{agentLabel}
						<span {...stylex.props(styles.metaDivider)} />
						{cwdLabel}
						<span {...stylex.props(styles.metaDivider)} />
						{messages.length || session.messageCount} messages
						<span {...stylex.props(styles.metaDivider)} />
						{formatRelativeTime(session.updatedAt)}
					</span>
					{session.lastMessage && (
						<span {...stylex.props(styles.lastMessage)}>
							{session.lastMessage}
						</span>
					)}
				</span>
			</button>
			<button
				type="button"
				onClick={onOpen}
				{...stylex.props(styles.openButton)}
			>
				Open
			</button>
			<button
				type="button"
				onClick={onDelete}
				{...stylex.props(styles.deleteButton)}
				aria-label="Delete session history"
			>
				<IconTrash size={12} />
			</button>
		</article>
	);
}

function SessionDetail({
	session,
	detail,
	onOpen,
	onInject,
	onSaveArtifact,
	onSaveAction,
	status,
}: {
	session: StoredChatSession | null;
	detail?: SessionDetailModel;
	onOpen?: () => void;
	onInject?: () => void;
	onSaveArtifact?: () => void;
	onSaveAction?: () => void;
	status?: string | null;
}) {
	if (!session) {
		return (
			<aside {...stylex.props(styles.detailPane, styles.detailEmpty)}>
				Select a session
			</aside>
		);
	}
	const model = detail ?? loadSessionDetail(session);
	return (
		<aside {...stylex.props(styles.detailPane)}>
			<div {...stylex.props(styles.detailHeader)}>
				<div {...stylex.props(styles.detailTitleBlock)}>
					<span {...stylex.props(styles.detailKicker)}>
						{session.agentKind} · {model.workspaceLabel}
					</span>
					<h2 {...stylex.props(styles.detailTitle)}>{model.title}</h2>
				</div>
				<div {...stylex.props(styles.detailActions)}>
					{status ? (
						<span {...stylex.props(styles.detailStatusText)}>{status}</span>
					) : null}
					<button
						type="button"
						onClick={onOpen}
						{...stylex.props(styles.detailButton)}
					>
						Open
					</button>
					<button
						type="button"
						onClick={onSaveArtifact}
						{...stylex.props(styles.detailButton)}
					>
						Save Artifact
					</button>
					<button
						type="button"
						onClick={onInject}
						{...stylex.props(styles.detailButton)}
					>
						<IconFilePlus size={11} />
						Inject
					</button>
					<button
						type="button"
						onClick={onSaveAction}
						{...stylex.props(styles.detailButton)}
					>
						Save Action
					</button>
				</div>
			</div>
			<div {...stylex.props(styles.detailStats)}>
				<span
					{...stylex.props(
						styles.statusBadge,
						model.status === "running" && styles.statusRunning,
						model.status === "review" && styles.statusReview
					)}
				>
					{model.statusLabel}
				</span>
				<span>{model.messageCount} messages</span>
				<span>{model.checkpointCount} checkpoints</span>
				<span>{model.changedFiles.length} files</span>
				<span>{model.artifacts.length} artifacts</span>
			</div>
			<DetailList title="Changed files" items={model.changedFiles} />
			<DetailList title="Commands" items={model.commands} />
			<ArtifactList artifacts={model.artifacts} />
			<div {...stylex.props(styles.transcriptPreview)}>
				<div {...stylex.props(styles.detailSectionTitle)}>Transcript</div>
				{model.recentMessages.length === 0 ? (
					<span {...stylex.props(styles.detailMuted)}>
						No retained messages
					</span>
				) : (
					model.recentMessages.map((message) => (
						<div key={message.id} {...stylex.props(styles.messagePreview)}>
							<span {...stylex.props(styles.messageRole)}>{message.role}</span>
							<span {...stylex.props(styles.messageText)}>
								{message.content}
							</span>
						</div>
					))
				)}
			</div>
		</aside>
	);
}

function DetailList({ title, items }: { title: string; items: string[] }) {
	return (
		<div {...stylex.props(styles.detailSection)}>
			<div {...stylex.props(styles.detailSectionTitle)}>{title}</div>
			{items.length === 0 ? (
				<span {...stylex.props(styles.detailMuted)}>None recorded</span>
			) : (
				<div {...stylex.props(styles.detailPills)}>
					{items.slice(0, 8).map((item) => (
						<span key={item} {...stylex.props(styles.detailPill)}>
							{item}
						</span>
					))}
				</div>
			)}
		</div>
	);
}

function ArtifactList({
	artifacts,
}: {
	artifacts: SessionDetailModel["artifacts"];
}) {
	return (
		<div {...stylex.props(styles.detailSection)}>
			<div {...stylex.props(styles.detailSectionTitle)}>Artifacts</div>
			{artifacts.length === 0 ? (
				<span {...stylex.props(styles.detailMuted)}>None saved</span>
			) : (
				<div {...stylex.props(styles.artifactStack)}>
					{artifacts.slice(0, 6).map((artifact) => (
						<div key={artifact.id} {...stylex.props(styles.artifactRow)}>
							<span {...stylex.props(styles.artifactTitle)}>
								{artifact.title}
							</span>
							<span {...stylex.props(styles.artifactMeta)}>
								{artifact.subtitle} · {formatRelativeTime(artifact.updatedAt)}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

const styles = stylex.create({
	toolbarFilters: {
		marginLeft: controlSize._2,
	},
	content: {
		flex: 1,
		minHeight: 0,
		padding: controlSize._3,
	},
	sessionGrid: {
		display: "grid",
		gap: controlSize._3,
		gridTemplateColumns: "minmax(22rem, 0.9fr) minmax(24rem, 1.1fr)",
		height: "100%",
		minHeight: 0,
	},
	sessionList: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		minHeight: 0,
		overflowY: "auto",
	},
	sessionRow: {
		display: "flex",
		alignItems: "stretch",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: {
			default: color.border,
			":hover": color.borderStrong,
		},
		borderRadius: radius.lg,
		backgroundColor: {
			default: "transparent",
			":hover": color.surfaceSubtle,
		},
		transitionProperty: "background-color, border-color",
		transitionDuration: motion.durationFast,
	},
	sessionRowActive: {
		borderColor: color.accentBorder,
		backgroundColor: color.surfaceSubtle,
	},
	openArea: {
		display: "flex",
		flex: 1,
		minWidth: 0,
		alignItems: "flex-start",
		gap: controlSize._3,
		textAlign: "left",
		padding: controlSize._3,
	},
	agentIcon: {
		display: "flex",
		width: controlSize._7,
		height: controlSize._7,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.lg,
		backgroundColor: color.backgroundRaised,
		color: color.textSoft,
	},
	sessionMain: {
		display: "flex",
		minWidth: 0,
		flex: 1,
		flexDirection: "column",
		gap: controlSize._1,
	},
	sessionTitle: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
	},
	sessionMeta: {
		display: "flex",
		alignItems: "center",
		flexWrap: "wrap",
		gap: controlSize._1,
		color: color.textMuted,
		fontSize: font.size_1,
	},
	statusBadge: {
		backgroundColor: color.surfaceSubtle,
		borderColor: color.borderSubtle,
		borderRadius: radius.sm,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMuted,
		flexShrink: 0,
		fontSize: font.size_0,
		fontWeight: font.weight_6,
		lineHeight: 1,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._1,
		textTransform: "uppercase",
	},
	statusRunning: {
		backgroundColor: color.accentWash,
		borderColor: color.accentBorder,
		color: color.textMain,
	},
	statusReview: {
		backgroundColor: color.warningWash,
		borderColor: color.warningBorder,
		color: color.warning,
	},
	metaDivider: {
		width: 3,
		height: 3,
		borderRadius: 999,
		backgroundColor: color.textMuted,
		opacity: 0.35,
	},
	lastMessage: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_1,
		lineHeight: 1.5,
	},
	deleteButton: {
		display: "flex",
		width: "2.75rem",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
		color: {
			default: color.textMuted,
			":hover": color.danger,
		},
	},
	openButton: {
		alignItems: "center",
		borderLeftColor: color.border,
		borderLeftStyle: "solid",
		borderLeftWidth: 1,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		display: "flex",
		flexShrink: 0,
		fontSize: font.size_1,
		justifyContent: "center",
		paddingInline: controlSize._3,
	},
	detailPane: {
		backgroundColor: color.backgroundRaised,
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._3,
		minHeight: 0,
		overflowY: "auto",
		padding: controlSize._3,
	},
	detailEmpty: {
		alignItems: "center",
		color: color.textMuted,
		justifyContent: "center",
	},
	detailHeader: {
		alignItems: "flex-start",
		display: "flex",
		gap: controlSize._3,
		justifyContent: "space-between",
		minWidth: 0,
	},
	detailTitleBlock: {
		minWidth: 0,
	},
	detailKicker: {
		color: color.textMuted,
		fontSize: font.size_1,
		textTransform: "uppercase",
	},
	detailTitle: {
		color: color.textMain,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
		lineHeight: 1.2,
		margin: 0,
		marginTop: controlSize._1,
	},
	detailActions: {
		alignItems: "center",
		display: "flex",
		flexShrink: 0,
		flexWrap: "wrap",
		gap: controlSize._1,
		justifyContent: "flex-end",
	},
	detailStatusText: {
		color: color.textMuted,
		fontSize: font.size_0_5,
		marginInlineEnd: controlSize._1,
	},
	detailButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.surfaceControl,
			":hover": color.surfaceControlHover,
		},
		borderColor: color.border,
		borderRadius: radius.sm,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		display: "flex",
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
	},
	detailStats: {
		color: color.textMuted,
		display: "flex",
		flexWrap: "wrap",
		fontSize: font.size_1,
		gap: controlSize._2,
	},
	detailSection: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
	},
	detailSectionTitle: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		textTransform: "uppercase",
	},
	detailMuted: {
		color: color.textFaint,
		fontSize: font.size_1,
	},
	detailPills: {
		display: "flex",
		flexWrap: "wrap",
		gap: controlSize._1,
	},
	detailPill: {
		backgroundColor: color.surfaceSubtle,
		borderColor: color.borderSubtle,
		borderRadius: radius.sm,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMuted,
		fontSize: font.size_1,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._1,
	},
	artifactStack: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
	},
	artifactRow: {
		backgroundColor: color.surfaceSubtle,
		borderColor: color.borderSubtle,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._0_5,
		padding: controlSize._2,
	},
	artifactTitle: {
		color: color.textSoft,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	artifactMeta: {
		color: color.textMuted,
		fontSize: font.size_0_5,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	transcriptPreview: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
	},
	messagePreview: {
		backgroundColor: color.surfaceSubtle,
		borderColor: color.borderSubtle,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		padding: controlSize._2,
	},
	messageRole: {
		color: color.textMuted,
		fontSize: font.size_0,
		fontWeight: font.weight_6,
		textTransform: "uppercase",
	},
	messageText: {
		color: color.textSoft,
		display: "-webkit-box",
		fontSize: font.size_1,
		lineHeight: 1.45,
		overflow: "hidden",
		WebkitBoxOrient: "vertical",
		WebkitLineClamp: 4,
	},
	emptyState: {
		display: "flex",
		height: "100%",
		alignItems: "center",
		justifyContent: "center",
		gap: controlSize._2,
		color: color.textMuted,
		fontSize: font.size_2,
	},
});
