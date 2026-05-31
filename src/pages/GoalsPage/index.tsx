import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Markdown } from "../../components/chat/ChatRichContent.tsx";
import { DotMatrixRipple } from "../../components/ui/DotMatrixLoader.tsx";
import {
	IconMessageCircle,
	IconTarget,
	IconTrash,
} from "../../components/ui/Icons.tsx";
import {
	WorkspaceContent,
	WorkspaceEmptyState,
	WorkspacePage,
	WorkspaceToolbar,
	WorkspaceToolbarSpacer,
} from "../../components/ui/WorkspacePage.tsx";
import { getAgentIcon } from "../../features/agents/agent-ui.tsx";
import type { ChatMessage } from "../../features/chat/agent-chat-shared.ts";
import {
	clearAgentChatMessages,
	loadSessionLibrary,
	loadStoredMessages,
	type StoredChatSession,
	savePendingSend,
} from "../../features/chat/chat-session-store.ts";
import {
	loadQuickActions,
	saveQuickActionDraft,
} from "../../features/quick-actions/quick-actions-store.ts";
import {
	buildTaskAgentPrompt,
	buildTaskBoardCards,
	buildTaskQuickActionDraft,
	clearTaskStatusOverride,
	loadPromotedTasks,
	loadTaskStatusOverrides,
	removePromotedTask,
	setTaskStatusOverride,
	TASK_BOARD_COLUMNS,
} from "../../features/task-board/task-board-store.ts";
import type {
	TaskBoardCard,
	TaskBoardStatus,
} from "../../features/task-board/types.ts";
import {
	type AgentKind,
	createGroupId,
	createTerminalPane,
	DEFAULT_FONT_FAMILY,
	DEFAULT_FONT_SIZE,
	DEFAULT_OPACITY,
	loadTerminalState,
	prependPaneToGroup,
	saveTerminalState,
} from "../../features/terminal/terminal-utils.ts";
import { usePollingResource } from "../../hooks/usePollingResource.ts";
import { DEFAULT_APP_ROUTE } from "../../lib/app-navigation.tsx";
import { fetchJsonOr } from "../../lib/fetch-json.ts";
import { basename, formatElapsedMs } from "../../lib/format.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
	shadow,
} from "../../tokens.stylex.ts";

interface GoalInfo {
	paneId: string;
	agentKind: "claude" | "codex";
	cwd: string;
	sessionId: string | null;
	isRunning: boolean;
	clientCount: number;
	objective: string;
	status: "active" | "paused";
	turns: number;
	startedAt: number;
	elapsedMs: number;
	recentMessages: Array<{
		role: "assistant" | "system";
		content: string;
	}>;
	brief: {
		phase: string;
		currentStep: string;
		nextAction: string;
		blocker: string | null;
		lastResult: string | null;
	};
	activity: Array<{
		id: string;
		type: "status" | "tool" | "result" | "system" | "error";
		label: string;
		detail: string | null;
		state: "running" | "complete" | "paused" | "error";
	}>;
	files: string[];
	checks: string[];
}

export function GoalsPage() {
	const navigate = useNavigate();
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
	const [taskVersion, setTaskVersion] = useState(0);
	const [taskActionStatus, setTaskActionStatus] = useState<string | null>(null);

	const loadGoals = useCallback(async () => {
		const payload = await fetchJsonOr<{ goals?: GoalInfo[] }>("/api/goals", {
			goals: [],
		});
		return Array.isArray(payload.goals) ? payload.goals : [];
	}, []);
	const { data: goals, loaded } = usePollingResource(loadGoals, 1500, []);
	const taskCards = useMemo(() => {
		void taskVersion;
		const sessions = loadSessionLibrary();
		const messagesByPaneId = new Map<string, ChatMessage[]>();
		for (const session of sessions) {
			messagesByPaneId.set(
				session.paneId,
				loadStoredMessages<ChatMessage>(session.paneId)
			);
		}
		return buildTaskBoardCards({
			goals: goals.map((goal) => ({
				paneId: goal.paneId,
				agentKind: goal.agentKind,
				cwd: goal.cwd,
				objective: goal.objective,
				isRunning: goal.isRunning,
				status: goal.status,
				updatedAt: goal.startedAt + goal.elapsedMs,
				files: goal.files,
				checks: goal.checks,
			})),
			sessions,
			messagesByPaneId,
			promotedTasks: loadPromotedTasks(),
			statusOverrides: loadTaskStatusOverrides(),
		});
	}, [goals, taskVersion]);
	const selectedTask =
		taskCards.find((task) => task.id === selectedTaskId) ??
		taskCards[0] ??
		null;

	const selectedGoal =
		selectedTask?.source === "goal"
			? (goals.find((goal) => goal.paneId === selectedTask.paneId) ?? null)
			: null;
	const selectedSessionTask =
		selectedTask?.source === "session" || selectedTask?.source === "promoted"
			? selectedTask
			: null;
	const moveTask = useCallback((taskId: string, status: TaskBoardStatus) => {
		setTaskStatusOverride(taskId, status);
		setTaskVersion((version) => version + 1);
	}, []);
	useEffect(
		() =>
			listenWindowEvent("inferay-task-board-change", () =>
				setTaskVersion((version) => version + 1)
			),
		[]
	);
	const selectTask = useCallback((task: TaskBoardCard) => {
		setSelectedTaskId(task.id);
	}, []);
	const launchTaskAgent = useCallback(
		(task: TaskBoardCard, agentKind: "claude" | "codex") => {
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
			if (!selectedGroupId) return;
			const recent = loadStoredMessages<ChatMessage>(task.paneId).slice(-6);
			const pane = createTerminalPane(
				agentKind,
				task.cwd ?? undefined,
				!task.cwd
			);
			savePendingSend(pane.id, buildTaskAgentPrompt(task, recent));
			saveTerminalState({
				groups: groups.map(
					prependPaneToGroup.bind(null, selectedGroupId, pane)
				),
				selectedGroupId,
				themeId: existing?.themeId ?? ("default" as const),
				fontSize: existing?.fontSize ?? DEFAULT_FONT_SIZE,
				fontFamily: existing?.fontFamily ?? DEFAULT_FONT_FAMILY,
				opacity: existing?.opacity ?? DEFAULT_OPACITY,
			});
			window.dispatchEvent(new Event("terminal-shell-change"));
			navigate(DEFAULT_APP_ROUTE);
		},
		[navigate]
	);
	const saveTaskAction = useCallback((task: TaskBoardCard) => {
		const recent = loadStoredMessages<ChatMessage>(task.paneId).slice(-6);
		const draft = buildTaskQuickActionDraft(task, recent);
		const sourceTag = `task:${task.id}`;
		const existing = loadQuickActions().find((profile) =>
			profile.tags.includes(sourceTag)
		);
		const action = saveQuickActionDraft(draft, existing?.id);
		setTaskActionStatus(`Saved "${action.name}" as an automation piece.`);
	}, []);
	const deleteTask = useCallback(async (task: TaskBoardCard) => {
		if (!confirm(`Remove "${task.title}" from Work?`)) return;
		if (task.source === "goal") {
			await fetch("/api/goals/clear", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ paneId: task.paneId }),
			});
			clearAgentChatMessages(task.paneId);
		} else if (task.source === "promoted" && task.promotedTask) {
			removePromotedTask(task.promotedTask.id);
		} else if (task.source === "session") {
			clearAgentChatMessages(task.paneId);
		}
		clearTaskStatusOverride(task.id);
		setSelectedTaskId(null);
		setTaskVersion((version) => version + 1);
	}, []);

	return (
		<WorkspacePage>
			<WorkspaceToolbar>
				<WorkspaceToolbarSpacer />
			</WorkspaceToolbar>
			<WorkspaceContent padding="none">
				<div {...stylex.props(styles.body)}>
					<div {...stylex.props(styles.list)}>
						{taskCards.length > 0 ? (
							taskCards.map((task) => (
								<WorkItemRow
									key={task.id}
									task={task}
									selected={selectedTask?.id === task.id}
									goal={goals.find((item) => item.paneId === task.paneId)}
									onSelect={() => selectTask(task)}
									onDelete={() => void deleteTask(task)}
								/>
							))
						) : loaded ? (
							<WorkspaceEmptyState
								icon={<IconTarget size={16} />}
								title="No active work"
								description="Start a coding agent or keep a session to see the work that needs follow-up."
							/>
						) : (
							<div {...stylex.props(styles.outputEmpty)}>Loading work...</div>
						)}
					</div>

					<aside {...stylex.props(styles.detailPane)}>
						{selectedSessionTask ? (
							<SessionTaskDetail
								key={selectedSessionTask.id}
								task={selectedSessionTask}
								onMove={moveTask}
								onLaunchAgent={launchTaskAgent}
								onSaveAction={saveTaskAction}
								actionStatus={taskActionStatus}
							/>
						) : selectedGoal ? (
							<>
								<div {...stylex.props(styles.detailHeader)}>
									<div {...stylex.props(styles.detailTitleBlock)}>
										<span {...stylex.props(styles.detailKicker)}>
											{basename(selectedGoal.cwd.replace(/\/+$/, "")) ||
												selectedGoal.cwd}
										</span>
										<h2 {...stylex.props(styles.detailTitle)}>
											{selectedGoal.objective}
										</h2>
									</div>
									<GoalStatus goal={selectedGoal} />
								</div>
								{selectedTask?.source === "goal" && (
									<TaskAgentActions
										task={selectedTask}
										onLaunchAgent={launchTaskAgent}
										onSaveAction={saveTaskAction}
									/>
								)}
								{taskActionStatus ? (
									<div {...stylex.props(styles.issueDetailStatus)}>
										{taskActionStatus}
									</div>
								) : null}
								<div {...stylex.props(styles.signalGrid)}>
									<SignalList title="Files" items={selectedGoal.files} />
									<SignalList title="Checks" items={selectedGoal.checks} />
								</div>

								<div {...stylex.props(styles.outputSection)}>
									<div {...stylex.props(styles.outputHeader)}>
										<span>Activity</span>
										<span {...stylex.props(styles.outputCount)}>
											{selectedGoal.activity.length}
										</span>
									</div>
									<div {...stylex.props(styles.outputList)}>
										{selectedGoal.activity.length > 0 ? (
											selectedGoal.activity.map((activity, index) => (
												<div
													key={activity.id}
													{...stylex.props(styles.outputItem)}
												>
													<span {...stylex.props(styles.outputRail)}>
														<span
															{...stylex.props(
																styles.outputDot,
																styles[activity.state]
															)}
														/>
														{index < selectedGoal.activity.length - 1 && (
															<span {...stylex.props(styles.outputLine)} />
														)}
													</span>
													<div {...stylex.props(styles.outputBody)}>
														<span {...stylex.props(styles.outputRole)}>
															{activity.type}
														</span>
														<div {...stylex.props(styles.activityTitle)}>
															{activity.label}
														</div>
														{activity.detail && (
															<div {...stylex.props(styles.outputContent)}>
																{activity.detail}
															</div>
														)}
													</div>
												</div>
											))
										) : (
											<div {...stylex.props(styles.outputEmpty)}>
												No output yet
											</div>
										)}
									</div>
								</div>

								<details {...stylex.props(styles.transcriptDetails)}>
									<summary {...stylex.props(styles.transcriptSummary)}>
										Raw transcript
										<span {...stylex.props(styles.outputCount)}>
											{selectedGoal.recentMessages.length}
										</span>
									</summary>
									<div {...stylex.props(styles.transcriptList)}>
										{selectedGoal.recentMessages.map((message, index) => (
											<div
												key={`${message.role}-${index}`}
												{...stylex.props(styles.transcriptItem)}
											>
												<span {...stylex.props(styles.outputRole)}>
													{message.role}
												</span>
												<Markdown text={message.content} />
											</div>
										))}
									</div>
								</details>
							</>
						) : (
							<WorkspaceEmptyState
								icon={<IconTarget size={16} />}
								title="Select a goal or task"
								description="Inspect agent output, task context, changed files, checks, and launch follow-up agents from here."
							/>
						)}
					</aside>
				</div>
			</WorkspaceContent>
		</WorkspacePage>
	);
}

function workSourceLabel(task: TaskBoardCard): string {
	if (task.source === "goal") return "Goal";
	if (task.source === "promoted") return "Task";
	return "Session";
}

function WorkItemRow({
	task,
	selected,
	goal,
	onSelect,
	onDelete,
}: {
	task: TaskBoardCard;
	selected: boolean;
	goal?: GoalInfo;
	onSelect: () => void;
	onDelete: () => void;
}) {
	return (
		<div {...stylex.props(styles.goalRow, selected && styles.goalRowSelected)}>
			<button
				type="button"
				onClick={onSelect}
				{...stylex.props(styles.goalRowSelect)}
			>
				<AgentBadge agentKind={task.agentKind} />
				<span {...stylex.props(styles.goalMain)}>
					<span {...stylex.props(styles.goalTitle)}>{task.title}</span>
					<span {...stylex.props(styles.goalMeta)}>
						{workSourceLabel(task)}
						<span {...stylex.props(styles.metaDivider)} />
						{task.subtitle}
						{task.messageCount > 0 ? (
							<>
								<span {...stylex.props(styles.metaDivider)} />
								{task.messageCount} msg
							</>
						) : null}
						{goal ? (
							<>
								<span {...stylex.props(styles.metaDivider)} />
								{formatElapsedMs(goal.elapsedMs)}
							</>
						) : null}
					</span>
				</span>
				{goal ? (
					<GoalStatus goal={goal} />
				) : (
					<span {...stylex.props(styles.statusPill, styles.statusPaused)}>
						<span {...stylex.props(styles.statusDot)} />
						{task.status}
					</span>
				)}
			</button>
			<button
				type="button"
				onClick={onDelete}
				{...stylex.props(styles.goalDeleteButton)}
				title="Remove from Work"
			>
				<IconTrash size={12} />
			</button>
		</div>
	);
}

function SignalList({ title, items }: { title: string; items: string[] }) {
	return (
		<div {...stylex.props(styles.signalList)}>
			<div {...stylex.props(styles.outputHeader)}>
				<span>{title}</span>
				<span {...stylex.props(styles.outputCount)}>{items.length}</span>
			</div>
			<div {...stylex.props(styles.signalBody)}>
				{items.length > 0 ? (
					items.map((item) => (
						<span key={item} {...stylex.props(styles.signalItem)}>
							{item}
						</span>
					))
				) : (
					<span {...stylex.props(styles.signalEmpty)}>None yet</span>
				)}
			</div>
		</div>
	);
}

function isKnownAgentKind(value: string): value is AgentKind {
	return value === "claude" || value === "codex" || value === "terminal";
}

function AgentBadge({ agentKind }: { agentKind: string }) {
	return (
		<span {...stylex.props(styles.agentIcon)}>
			{isKnownAgentKind(agentKind) ? (
				getAgentIcon(agentKind, 13)
			) : (
				<IconMessageCircle size={13} />
			)}
		</span>
	);
}

function SessionTaskDetail({
	task,
	onMove,
	onLaunchAgent,
	onSaveAction,
	actionStatus,
}: {
	task: TaskBoardCard & { session?: StoredChatSession };
	onMove: (taskId: string, status: TaskBoardStatus) => void;
	onLaunchAgent: (task: TaskBoardCard, agentKind: "claude" | "codex") => void;
	onSaveAction: (task: TaskBoardCard) => void;
	actionStatus: string | null;
}) {
	const messages = loadStoredMessages<ChatMessage>(task.paneId);
	const recent = task.promotedTask
		? [
				{
					id: task.promotedTask.messageId,
					role: task.promotedTask.messageRole,
					content: task.promotedTask.content,
				} as ChatMessage,
			]
		: messages.slice(-6).reverse();
	return (
		<>
			<div {...stylex.props(styles.detailHeader)}>
				<div {...stylex.props(styles.detailTitleBlock)}>
					<span {...stylex.props(styles.detailKicker)}>{task.subtitle}</span>
					<h2 {...stylex.props(styles.detailTitle)}>{task.title}</h2>
				</div>
				<span {...stylex.props(styles.statusPill, styles.statusActive)}>
					{task.status}
				</span>
			</div>
			<div {...stylex.props(styles.taskMoveBar)}>
				{TASK_BOARD_COLUMNS.map((column) => (
					<button
						key={column.id}
						type="button"
						onClick={() => onMove(task.id, column.id)}
						{...stylex.props(
							styles.moveButton,
							task.status === column.id && styles.moveButtonActive
						)}
					>
						{column.label}
					</button>
				))}
			</div>
			<TaskAgentActions
				task={task}
				onLaunchAgent={onLaunchAgent}
				onSaveAction={onSaveAction}
			/>
			{actionStatus ? (
				<div {...stylex.props(styles.issueDetailStatus)}>{actionStatus}</div>
			) : null}
			<div {...stylex.props(styles.signalGrid)}>
				<SignalList title="Signals" items={task.signals} />
				<SignalList
					title="Session"
					items={[
						task.session?.model ?? task.agentKind,
						task.session?.reasoningLevel ??
							(task.promotedTask ? "promoted message" : "default reasoning"),
					]}
				/>
			</div>
			<div {...stylex.props(styles.outputSection)}>
				<div {...stylex.props(styles.outputHeader)}>
					<span>Recent session context</span>
					<span {...stylex.props(styles.outputCount)}>{recent.length}</span>
				</div>
				<div {...stylex.props(styles.outputList)}>
					{recent.length > 0 ? (
						recent.map((message) => (
							<div key={message.id} {...stylex.props(styles.outputBody)}>
								<span {...stylex.props(styles.outputRole)}>{message.role}</span>
								<div {...stylex.props(styles.outputContent)}>
									{message.content}
								</div>
							</div>
						))
					) : (
						<div {...stylex.props(styles.outputEmpty)}>
							No retained messages yet
						</div>
					)}
				</div>
			</div>
		</>
	);
}

function TaskAgentActions({
	task,
	onLaunchAgent,
	onSaveAction,
}: {
	task: TaskBoardCard;
	onLaunchAgent: (task: TaskBoardCard, agentKind: "claude" | "codex") => void;
	onSaveAction: (task: TaskBoardCard) => void;
}) {
	return (
		<div {...stylex.props(styles.taskAgentBar)}>
			<span {...stylex.props(styles.taskAgentLabel)}>Launch task agent</span>
			<button
				type="button"
				onClick={() => onSaveAction(task)}
				{...stylex.props(styles.moveButton)}
			>
				Save Action
			</button>
			<button
				type="button"
				onClick={() => onLaunchAgent(task, "claude")}
				{...stylex.props(styles.moveButton)}
			>
				Claude
			</button>
			<button
				type="button"
				onClick={() => onLaunchAgent(task, "codex")}
				{...stylex.props(styles.moveButton)}
			>
				Codex
			</button>
		</div>
	);
}

function GoalStatus({ goal }: { goal: GoalInfo }) {
	return (
		<span
			{...stylex.props(
				styles.statusPill,
				goal.isRunning
					? styles.statusRunning
					: goal.status === "active"
						? styles.statusActive
						: styles.statusPaused
			)}
		>
			{goal.isRunning ? (
				<span {...stylex.props(styles.thinkingSlot)}>
					<DotMatrixRipple
						dotSize={1.5}
						gap={1}
						speed={1.15}
						ariaLabel="Goal running"
					/>
				</span>
			) : (
				<span {...stylex.props(styles.statusDot)} />
			)}
			{goal.isRunning ? "Running" : goal.status}
		</span>
	);
}

const styles = stylex.create({
	taskMoveBar: {
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		flexShrink: 0,
		gap: controlSize._1,
		overflowX: "auto",
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	taskAgentBar: {
		alignItems: "center",
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		flexShrink: 0,
		gap: controlSize._1,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	issueDetailStatus: {
		color: color.textMuted,
		fontSize: font.size_1,
		marginLeft: controlSize._1,
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	taskAgentLabel: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		marginRight: controlSize._1,
		textTransform: "uppercase",
	},
	moveButton: {
		backgroundColor: {
			default: color.surfaceControl,
			":hover": color.surfaceControlHover,
		},
		borderColor: color.border,
		borderRadius: radius.sm,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMuted,
		cursor: "pointer",
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
	},
	moveButtonActive: {
		backgroundColor: color.controlActive,
		borderColor: color.borderStrong,
		color: color.textMain,
	},
	body: {
		display: "grid",
		flex: 1,
		gridTemplateColumns: "minmax(280px, 0.9fr) minmax(320px, 1.1fr)",
		minHeight: 0,
		minWidth: 0,
	},
	list: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		overflowY: "auto",
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	goalRow: {
		alignItems: "center",
		backgroundColor: {
			default: color.surfaceTranslucent,
			":hover": color.surfaceControl,
		},
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: {
			default: shadow.none,
			":hover": shadow.selectedRing,
		},
		display: "flex",
		gap: controlSize._2,
		minHeight: controlSize._10,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
		textAlign: "left",
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, border-color, box-shadow",
		transitionTimingFunction: motion.ease,
		width: "100%",
	},
	goalRowSelect: {
		alignItems: "center",
		display: "flex",
		flex: 1,
		gap: controlSize._2,
		minWidth: 0,
		textAlign: "left",
	},
	goalRowSelected: {
		backgroundColor: color.controlActive,
		borderColor: color.borderStrong,
	},
	goalDeleteButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.dangerWash,
		},
		borderRadius: radius.sm,
		color: {
			default: color.textMuted,
			":hover": color.danger,
		},
		display: "flex",
		flexShrink: 0,
		height: controlSize._7,
		justifyContent: "center",
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, color",
		transitionTimingFunction: motion.ease,
		width: controlSize._7,
	},
	agentIcon: {
		alignItems: "center",
		backgroundColor: color.surfaceControl,
		borderColor: color.borderSubtle,
		borderRadius: radius.sm,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		display: "flex",
		flexShrink: 0,
		height: controlSize._6,
		justifyContent: "center",
		width: controlSize._6,
	},
	goalMain: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		gap: controlSize._0_5,
		minWidth: 0,
	},
	goalTitle: {
		color: color.textMain,
		fontSize: font.size_3,
		fontWeight: font.weight_5,
		lineHeight: 1.25,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	goalMeta: {
		alignItems: "center",
		color: color.textMuted,
		display: "flex",
		fontSize: font.size_1,
		gap: controlSize._1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	metaDivider: {
		backgroundColor: color.borderStrong,
		borderRadius: radius.pill,
		display: "inline-flex",
		flexShrink: 0,
		height: controlSize._0_5,
		width: controlSize._0_5,
	},
	statusPill: {
		alignItems: "center",
		borderRadius: radius.pill,
		borderStyle: "solid",
		borderWidth: 1,
		display: "inline-flex",
		flexShrink: 0,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._2,
		textTransform: "capitalize",
	},
	thinkingSlot: {
		alignItems: "center",
		color: color.textSoft,
		display: "flex",
		flexShrink: 0,
		height: controlSize._4,
		justifyContent: "center",
		width: controlSize._4,
	},
	statusDot: {
		backgroundColor: "currentColor",
		borderRadius: radius.pill,
		height: controlSize._1,
		width: controlSize._1,
	},
	statusRunning: {
		backgroundColor: color.surfaceControl,
		borderColor: color.border,
		color: color.textSoft,
	},
	statusActive: {
		backgroundColor: color.accentWash,
		borderColor: color.accentBorder,
		color: color.accent,
	},
	statusPaused: {
		borderColor: color.border,
		backgroundColor: color.surfaceControl,
		color: color.textMuted,
	},
	detailPane: {
		borderLeftColor: color.border,
		borderLeftStyle: "solid",
		borderLeftWidth: 1,
		display: "flex",
		flexDirection: "column",
		minHeight: 0,
		minWidth: 0,
		overflow: "hidden",
	},
	detailHeader: {
		alignItems: "flex-start",
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		gap: controlSize._3,
		justifyContent: "space-between",
		paddingBlock: controlSize._3,
		paddingInline: controlSize._3,
	},
	detailTitleBlock: {
		minWidth: 0,
	},
	detailKicker: {
		color: color.textMuted,
		display: "block",
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		marginBottom: controlSize._1,
		textTransform: "uppercase",
	},
	detailTitle: {
		color: color.textMain,
		fontSize: font.size_4,
		fontWeight: font.weight_6,
		lineHeight: 1.35,
		margin: 0,
	},
	signalGrid: {
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "grid",
		gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
		minHeight: controlSize._16,
	},
	signalList: {
		borderRightColor: color.border,
		borderRightStyle: "solid",
		borderRightWidth: 1,
		display: "flex",
		flexDirection: "column",
		minWidth: 0,
	},
	signalBody: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		maxHeight: 104,
		overflowY: "auto",
		padding: controlSize._2,
	},
	signalItem: {
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	signalEmpty: {
		color: color.textMuted,
		fontSize: font.size_1,
	},
	outputSection: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		minHeight: 0,
	},
	outputHeader: {
		alignItems: "center",
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		color: color.textMuted,
		display: "flex",
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		justifyContent: "space-between",
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
		textTransform: "uppercase",
	},
	outputCount: {
		color: color.textSoft,
		fontVariantNumeric: "tabular-nums",
	},
	outputList: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		overflowY: "auto",
		padding: controlSize._3,
	},
	outputItem: {
		display: "grid",
		gap: controlSize._2,
		gridTemplateColumns: "16px minmax(0, 1fr)",
		position: "relative",
	},
	outputRail: {
		alignItems: "center",
		display: "flex",
		flexDirection: "column",
		minHeight: "100%",
		paddingTop: controlSize._1,
	},
	outputDot: {
		backgroundColor: color.textMuted,
		borderColor: color.borderStrong,
		borderRadius: radius.pill,
		borderStyle: "solid",
		borderWidth: 1,
		flexShrink: 0,
		height: controlSize._2,
		width: controlSize._2,
	},
	running: {
		backgroundColor: color.textSoft,
		borderColor: color.borderStrong,
	},
	complete: {
		backgroundColor: color.success,
		borderColor: color.successBorder,
	},
	paused: {
		backgroundColor: color.warning,
		borderColor: color.warningBorder,
	},
	error: {
		backgroundColor: color.danger,
		borderColor: color.dangerBorder,
	},
	outputLine: {
		backgroundColor: color.border,
		flex: 1,
		marginBlock: controlSize._1,
		width: 1,
	},
	outputBody: {
		backgroundColor: color.surfaceTranslucent,
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		minWidth: 0,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._2,
	},
	outputRole: {
		color: color.textMuted,
		display: "block",
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		marginBottom: controlSize._1,
		textTransform: "uppercase",
	},
	activityTitle: {
		color: color.textMain,
		fontSize: font.size_3,
		fontWeight: font.weight_5,
		marginBottom: controlSize._0_5,
	},
	outputContent: {
		color: color.textSoft,
		fontSize: font.size_3,
		lineHeight: 1.45,
		minWidth: 0,
	},
	outputEmpty: {
		color: color.textMuted,
		fontSize: font.size_2,
		paddingBlock: controlSize._8,
		textAlign: "center",
	},
	transcriptDetails: {
		borderTopColor: color.border,
		borderTopStyle: "solid",
		borderTopWidth: 1,
		flexShrink: 0,
	},
	transcriptSummary: {
		alignItems: "center",
		color: color.textMuted,
		cursor: "pointer",
		display: "flex",
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		justifyContent: "space-between",
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
		textTransform: "uppercase",
	},
	transcriptList: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		maxHeight: 240,
		overflowY: "auto",
		padding: controlSize._3,
	},
	transcriptItem: {
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		fontSize: font.size_2,
		padding: controlSize._2,
	},
});
