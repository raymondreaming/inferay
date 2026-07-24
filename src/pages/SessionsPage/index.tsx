import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import {
	DropdownButton,
	type DropdownOption,
} from "../../components/ui/DropdownButton.tsx";
import {
	IconLayoutGrid,
	IconMessageCircle,
	IconPlus,
} from "../../components/ui/Icons.tsx";
import { getAgentIcon } from "../../features/agents/agent-ui.tsx";
import {
	dispatchAgentShellChange,
	loadCanonicalAgentState,
	mutateAgentWorkspaceState,
	type PaneId,
	type AgentShellChangeDetail,
	type AgentGroupModel,
	type AgentPaneModel,
} from "../../features/agent/agent-utils.ts";
import { AGENT_MAIN_VIEW_STORAGE_KEY } from "../../lib/client-storage-keys.ts";
import { fetchJsonOr } from "../../lib/fetch-json.ts";
import { basename, formatRelativeTime, trimText } from "../../lib/format.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";
import { writeStoredValue } from "../../lib/stored-json.ts";
import { color, font, radius } from "../../tokens.stylex.ts";

interface LocalSessionInfo {
	paneId: string;
	title: string;
	agentKind: "claude" | "codex";
	cwd: string | null;
	messageCount: number;
	lastMessage: string | null;
	lastRole: string | null;
	updatedAt: number;
	inCurrentWorkspace: boolean;
}

function sameSessions(
	prev: LocalSessionInfo[],
	next: LocalSessionInfo[]
): boolean {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		const a = prev[i]!;
		const b = next[i]!;
		if (
			a.paneId !== b.paneId ||
			a.title !== b.title ||
			a.agentKind !== b.agentKind ||
			a.cwd !== b.cwd ||
			a.messageCount !== b.messageCount ||
			a.lastMessage !== b.lastMessage ||
			a.lastRole !== b.lastRole ||
			a.updatedAt !== b.updatedAt ||
			a.inCurrentWorkspace !== b.inCurrentWorkspace
		)
			return false;
	}
	return true;
}

function sameWorkspaceOptions(
	prev: AgentGroupModel[],
	next: AgentGroupModel[]
): boolean {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		const a = prev[i]!;
		const b = next[i]!;
		if (a.id !== b.id || a.name !== b.name || a.panes.length !== b.panes.length)
			return false;
	}
	return true;
}

export function SessionsPage() {
	const [sessions, setSessions] = useState<LocalSessionInfo[]>([]);
	const [workspaces, setWorkspaces] = useState<AgentGroupModel[]>([]);
	const [loading, setLoading] = useState(true);

	const refresh = useCallback(async () => {
		try {
			const [sessionPayload, agentState] = await Promise.all([
				fetchJsonOr<{ sessions?: LocalSessionInfo[] }>("/api/sessions", {
					sessions: [],
				}),
				loadCanonicalAgentState(),
			]);
			const nextSessions = Array.isArray(sessionPayload.sessions)
				? sessionPayload.sessions
				: [];
			const nextWorkspaces = agentState?.groups ?? [];
			setSessions((current) =>
				sameSessions(current, nextSessions) ? current : nextSessions
			);
			setWorkspaces((current) =>
				sameWorkspaceOptions(current, nextWorkspaces) ? current : nextWorkspaces
			);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
		const id = window.setInterval(() => void refresh(), 2000);
		const cleanupShell = listenWindowEvent("agent-shell-change", (event) => {
			const detail = (event as CustomEvent<AgentShellChangeDetail>).detail;
			if (detail?.source === "view" && !detail.stateKey) return;
			void refresh();
		});
		const refreshOnFocus = () => void refresh();
		window.addEventListener("focus", refreshOnFocus);
		return () => {
			window.clearInterval(id);
			cleanupShell();
			window.removeEventListener("focus", refreshOnFocus);
		};
	}, [refresh]);

	const activeSessions = sessions.filter(
		(session) => session.inCurrentWorkspace
	);
	const archivedSessions = sessions.filter(
		(session) => !session.inCurrentWorkspace
	);
	const workspaceOptions = useMemo<DropdownOption[]>(
		() =>
			workspaces.map((workspace) => ({
				id: workspace.id,
				label: workspace.name,
				icon: <IconLayoutGrid size={11} />,
			})),
		[workspaces]
	);

	const restoreSession = useCallback(
		async (session: LocalSessionInfo, targetGroupId?: string) => {
			await mutateAgentWorkspaceState(
				(state) => {
					const existingGroup = state.groups.find((group) =>
						group.panes.some((pane) => pane.id === session.paneId)
					);
					if (existingGroup) {
						return {
							type: "selectPane",
							groupId: existingGroup.id,
							paneId: session.paneId,
						};
					}
					const pane: AgentPaneModel = {
						id: session.paneId as PaneId,
						title:
							session.title ||
							(session.cwd ? basename(session.cwd) : "Archived session"),
						agentKind: session.agentKind,
						isClaude: session.agentKind === "claude",
						paneType: session.agentKind,
						cwd: session.cwd ?? undefined,
						pendingCwd: !session.cwd,
					};
					return {
						type: "addPane",
						pane,
						groupId: targetGroupId,
					};
				},
				"restore-session",
				{ createIfMissing: true }
			);
			writeStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY, "chat");
			dispatchAgentShellChange({
				source: "view",
				reason: "restore-session",
			});
			window.location.hash = "#/agent";
		},
		[]
	);

	return (
		<div {...stylex.props(styles.root)}>
			<section {...stylex.props(styles.listPane)}>
				<div {...stylex.props(styles.toolbar)}>
					<div>
						<h1 {...stylex.props(styles.title)}>Sessions</h1>
						<p {...stylex.props(styles.subtitle)}>
							{sessions.length} local chat archives
						</p>
					</div>
				</div>
				<SessionGroup
					title="In Workspace"
					sessions={activeSessions}
					workspaceOptions={workspaceOptions}
					onOpen={restoreSession}
				/>
				<SessionGroup
					title="Archived"
					sessions={archivedSessions}
					workspaceOptions={workspaceOptions}
					onOpen={restoreSession}
				/>
				{!loading && sessions.length === 0 ? (
					<div {...stylex.props(styles.empty)}>
						<IconMessageCircle size={18} />
						<span>No saved sessions</span>
					</div>
				) : null}
			</section>
		</div>
	);
}

function SessionGroup({
	title,
	sessions,
	workspaceOptions,
	onOpen,
}: {
	title: string;
	sessions: LocalSessionInfo[];
	workspaceOptions: DropdownOption[];
	onOpen: (session: LocalSessionInfo, targetGroupId?: string) => void;
}) {
	if (sessions.length === 0) return null;
	return (
		<div {...stylex.props(styles.group)}>
			<div {...stylex.props(styles.groupTitle)}>{title}</div>
			{sessions.map((session) => (
				<div key={session.paneId} {...stylex.props(styles.sessionRow)}>
					<span {...stylex.props(styles.sessionIcon)}>
						{getAgentIcon(session.agentKind, 13)}
					</span>
					<span {...stylex.props(styles.sessionMain)}>
						<span {...stylex.props(styles.sessionTitle)}>{session.title}</span>
						<span {...stylex.props(styles.sessionMeta)}>
							{session.cwd ? basename(session.cwd) : "No folder"}
							<span {...stylex.props(styles.dot)} />
							{session.messageCount} messages
							<span {...stylex.props(styles.dot)} />
							{session.updatedAt
								? formatRelativeTime(session.updatedAt)
								: "Unknown"}
						</span>
						<span {...stylex.props(styles.sessionPreview)}>
							{trimText(session.lastMessage ?? "No message preview", 110)}
						</span>
					</span>
					<div {...stylex.props(styles.actionWrap)}>
						{session.inCurrentWorkspace ? (
							<Button
								type="button"
								variant="secondary"
								size="sm"
								onClick={() => onOpen(session)}
							>
								<IconPlus size={12} />
								<span>Open in Grid</span>
							</Button>
						) : (
							<DropdownButton
								value={null}
								options={workspaceOptions}
								onChange={(groupId) => onOpen(session, groupId)}
								placeholder="Add to Grid"
								icon={<IconPlus size={12} />}
								minWidth={180}
								menuPlacement="auto"
								buttonClassName={
									stylex.props(styles.gridDropdownButton).className
								}
								labelClassName={
									stylex.props(styles.gridDropdownLabel).className
								}
							/>
						)}
					</div>
				</div>
			))}
		</div>
	);
}

const styles = stylex.create({
	root: {
		display: "block",
		height: "100%",
		backgroundColor: color.transparent,
		color: color.textMain,
	},
	listPane: {
		minWidth: 0,
		overflow: "auto",
		height: "100%",
	},
	toolbar: {
		position: "sticky",
		top: 0,
		zIndex: 1,
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
		padding: "18px 20px 14px",
		backgroundColor: color.transparent,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
	},
	title: {
		margin: 0,
		fontSize: 18,
		fontWeight: font.weight_6,
		letterSpacing: 0,
	},
	subtitle: {
		margin: "4px 0 0",
		fontSize: 12,
		color: color.textMuted,
	},
	group: { padding: "14px 12px 4px" },
	groupTitle: {
		padding: "0 8px 8px",
		fontSize: 11,
		fontWeight: font.weight_6,
		textTransform: "uppercase",
		color: color.textMuted,
		letterSpacing: 0,
	},
	sessionRow: {
		display: "flex",
		width: "100%",
		alignItems: "center",
		gap: 10,
		padding: "10px 12px",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: "transparent",
		borderRadius: radius.sm,
		backgroundColor: "transparent",
		color: color.textMain,
		textAlign: "left",
		":hover": { backgroundColor: color.surfaceControlHover },
	},
	sessionIcon: {
		display: "flex",
		width: 22,
		height: 22,
		alignItems: "center",
		justifyContent: "center",
		flexShrink: 0,
		color: color.textMuted,
	},
	sessionMain: {
		display: "flex",
		minWidth: 0,
		flex: 1,
		flexDirection: "column",
		gap: 4,
	},
	sessionTitle: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		fontSize: 13,
		fontWeight: font.weight_6,
	},
	sessionMeta: {
		display: "flex",
		alignItems: "center",
		gap: 6,
		minWidth: 0,
		fontSize: 11,
		color: color.textMuted,
	},
	sessionPreview: {
		fontSize: 12,
		lineHeight: "17px",
		color: color.textSoft,
	},
	actionWrap: {
		display: "flex",
		flexShrink: 0,
		width: 180,
		justifyContent: "flex-end",
	},
	gridDropdownButton: {
		"--dropdown-button-bg-color": "transparent",
		"--dropdown-button-bg-image": "none",
		"--dropdown-button-border-color": color.borderSubtle,
		"--dropdown-button-hover-bg-color": color.surfaceControlHover,
		"--dropdown-button-hover-bg-image": "none",
		"--dropdown-button-open-bg-color": color.surfaceInset,
		"--dropdown-button-open-bg-image": "none",
		"--dropdown-button-shadow": "none",
		"--dropdown-button-hover-shadow": "none",
		"--dropdown-button-open-shadow": "none",
		height: 28,
		borderRadius: radius.sm,
		paddingInline: 10,
	},
	gridDropdownLabel: {
		color: color.textSoft,
		fontWeight: font.weight_5,
	},
	dot: {
		width: 3,
		height: 3,
		borderRadius: 99,
		backgroundColor: color.textMuted,
		flexShrink: 0,
	},
	empty: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		gap: 8,
		padding: 32,
		color: color.textMuted,
		fontSize: 13,
	},
});
