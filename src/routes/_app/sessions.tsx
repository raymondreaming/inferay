import * as stylex from "@octanejs/stylex";
import { createFileRoute, useNavigate } from "@octanejs/tanstack-router";
import { useCallback, useEffect, useMemo, useState } from "octane";
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
import { iconSize } from "../../design-system.ts";
import {
	type AgentGroupModel,
	type AgentPaneModel,
	type AgentShellChangeDetail,
	dispatchAgentShellChange,
	loadCanonicalAgentState,
	mutateAgentWorkspaceState,
	type PaneId,
} from "../../features/agent/agent-utils.ts";
import { getAgentIcon } from "../../features/agents/agent-ui.tsx";
import { AGENT_MAIN_VIEW_STORAGE_KEY } from "../../lib/client-storage-keys.ts";
import { fetchJsonOr } from "../../lib/fetch-json.ts";
import { basename, formatRelativeTime, trimText } from "../../lib/format.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";
import { writeStoredValue } from "../../lib/stored-json.ts";
import {
	color,
	controlSize,
	font,
	layer,
	radius,
} from "../../tokens.stylex.ts";

export const Route = createFileRoute("/_app/sessions")({
	component: SessionsPage,
});

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
	next: LocalSessionInfo[],
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
	next: AgentGroupModel[],
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
	const navigate = useNavigate();
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
				sameSessions(current, nextSessions) ? current : nextSessions,
			);
			setWorkspaces((current) =>
				sameWorkspaceOptions(current, nextWorkspaces)
					? current
					: nextWorkspaces,
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
		(session) => session.inCurrentWorkspace,
	);
	const archivedSessions = sessions.filter(
		(session) => !session.inCurrentWorkspace,
	);
	const workspaceOptions = useMemo<DropdownOption[]>(
		() =>
			workspaces.map((workspace) => ({
				id: workspace.id,
				label: workspace.name,
				icon: <IconLayoutGrid size={iconSize.compact} />,
			})),
		[workspaces],
	);

	const restoreSession = useCallback(
		async (session: LocalSessionInfo, targetGroupId?: string) => {
			await mutateAgentWorkspaceState(
				(state) => {
					const existingGroup = state.groups.find((group) =>
						group.panes.some((pane) => pane.id === session.paneId),
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
				{ createIfMissing: true },
			);
			writeStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY, "chat");
			dispatchAgentShellChange({
				source: "view",
				reason: "restore-session",
			});
			await navigate({ to: "/agent" });
		},
		[navigate],
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
						<IconMessageCircle size={iconSize._2xl} />
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
								<IconPlus size={iconSize.md} />
								<span>Open in Grid</span>
							</Button>
						) : (
							<DropdownButton
								value={null}
								options={workspaceOptions}
								onChange={(groupId) => onOpen(session, groupId)}
								placeholder="Add to Grid"
								icon={<IconPlus size={iconSize.md} />}
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
		minWidth: controlSize._0,
		overflow: "auto",
		height: "100%",
	},
	toolbar: {
		position: "sticky",
		top: controlSize._0,
		zIndex: layer.content,
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: controlSize._3,
		padding: "18px 20px 14px",
		backgroundColor: color.transparent,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
	},
	title: {
		margin: controlSize._0,
		fontSize: font.size_7,
		fontWeight: font.weight_6,
		letterSpacing: 0,
	},
	subtitle: {
		margin: "4px 0 0",
		fontSize: font.size_3,
		color: color.textMuted,
	},
	group: { padding: "14px 12px 4px" },
	groupTitle: {
		padding: "0 8px 8px",
		fontSize: font.size_2_75,
		fontWeight: font.weight_6,
		textTransform: "uppercase",
		color: color.textMuted,
		letterSpacing: 0,
	},
	sessionRow: {
		display: "flex",
		width: "100%",
		alignItems: "center",
		gap: controlSize._2_5,
		padding: "10px 12px",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.transparent,
		borderRadius: radius.sm,
		backgroundColor: color.transparent,
		color: color.textMain,
		textAlign: "left",
		":hover": { backgroundColor: color.surfaceControlHover },
	},
	sessionIcon: {
		display: "flex",
		width: controlSize._5_5,
		height: controlSize._5_5,
		alignItems: "center",
		justifyContent: "center",
		flexShrink: 0,
		color: color.textMuted,
	},
	sessionMain: {
		display: "flex",
		minWidth: controlSize._0,
		flex: 1,
		flexDirection: "column",
		gap: controlSize._1,
	},
	sessionTitle: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		fontSize: font.size_4,
		fontWeight: font.weight_6,
	},
	sessionMeta: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._1_5,
		minWidth: controlSize._0,
		fontSize: font.size_2_75,
		color: color.textMuted,
	},
	sessionPreview: {
		fontSize: font.size_3,
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
		height: controlSize._7,
		borderRadius: radius.sm,
		paddingInline: controlSize._2_5,
	},
	gridDropdownLabel: {
		color: color.textSoft,
		fontWeight: font.weight_5,
	},
	dot: {
		width: controlSize._0_75,
		height: controlSize._0_75,
		borderRadius: radius.pill,
		backgroundColor: color.textMuted,
		flexShrink: 0,
	},
	empty: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		gap: controlSize._2,
		padding: controlSize._8,
		color: color.textMuted,
		fontSize: font.size_4,
	},
});
