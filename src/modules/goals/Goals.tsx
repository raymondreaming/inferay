import * as stylex from "@octanejs/stylex";
import { useCallback, useState } from "octane";
import { fetchJsonOr } from "../../adapters/backend/http.ts";
import { iconSize } from "../../design-system.ts";
import { getAgentIcon } from "../../modules/agents/agent-ui.tsx";
import { usePollingQuery } from "../../shared/hooks/useQueryResource.tsx";
import { basename, formatElapsedMs } from "../../shared/lib/format.ts";
import { DotMatrixRipple } from "../../shared/ui/DotMatrixLoader.tsx";
import { IconTarget } from "../../shared/ui/Icons.tsx";
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
	activity: Array<{
		id: string;
		type: "status" | "tool" | "result" | "system" | "error";
		label: string;
		detail: string | null;
		state: "running" | "complete" | "paused" | "error";
	}>;
}

function areGoalsEqual(prev: GoalInfo[], next: GoalInfo[]) {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		const a = prev[i]!;
		const b = next[i]!;
		if (
			a.paneId !== b.paneId ||
			a.agentKind !== b.agentKind ||
			a.cwd !== b.cwd ||
			a.sessionId !== b.sessionId ||
			a.isRunning !== b.isRunning ||
			a.clientCount !== b.clientCount ||
			a.objective !== b.objective ||
			a.status !== b.status ||
			a.turns !== b.turns ||
			a.startedAt !== b.startedAt ||
			a.elapsedMs !== b.elapsedMs ||
			a.activity.length !== b.activity.length
		)
			return false;
		for (let j = 0; j < a.activity.length; j++) {
			const aa = a.activity[j]!;
			const ba = b.activity[j]!;
			if (
				aa.id !== ba.id ||
				aa.type !== ba.type ||
				aa.label !== ba.label ||
				aa.detail !== ba.detail ||
				aa.state !== ba.state
			)
				return false;
		}
	}
	return true;
}

export function GoalsPage() {
	const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);

	const loadGoals = useCallback(async () => {
		const payload = await fetchJsonOr<{ goals?: GoalInfo[] }>("/api/goals", {
			goals: [],
		});
		return Array.isArray(payload.goals) ? payload.goals : [];
	}, []);
	const { data: goals, loaded } = usePollingQuery(loadGoals, 1500, [], {
		queryKey: ["goals"],
		isEqual: areGoalsEqual,
	});

	const selectedGoal =
		goals.find((goal) => goal.paneId === selectedGoalId) ?? goals[0] ?? null;

	return (
		<div {...stylex.props(styles.root)}>
			<div {...stylex.props(styles.body)}>
				<div {...stylex.props(styles.list)}>
					{goals.length > 0 && (
						<div {...stylex.props(styles.listHeader)}>
							<span>Goal</span>
							<span>Status</span>
						</div>
					)}
					{goals.map((goal) => (
						<button
							key={goal.paneId}
							type="button"
							onClick={() => setSelectedGoalId(goal.paneId)}
							{...stylex.props(
								styles.goalRow,
								selectedGoal?.paneId === goal.paneId && styles.goalRowSelected,
							)}
						>
							<span {...stylex.props(styles.agentIcon)}>
								{getAgentIcon(goal.agentKind, 13)}
							</span>
							<span {...stylex.props(styles.goalMain)}>
								<span {...stylex.props(styles.goalTitle)}>
									{goal.objective}
								</span>
								<span {...stylex.props(styles.goalMeta)}>
									{basename(goal.cwd.replace(/\/+$/, "")) || goal.cwd}
									<span {...stylex.props(styles.metaDivider)} />
									{goal.turns} turns
									<span {...stylex.props(styles.metaDivider)} />
									{formatElapsedMs(goal.elapsedMs)}
								</span>
							</span>
							<GoalStatus goal={goal} />
						</button>
					))}
					{loaded && goals.length === 0 && (
						<div {...stylex.props(styles.emptyState)}>
							<IconTarget size={iconSize._2xl} />
							<span>No active goals</span>
						</div>
					)}
				</div>

				<aside {...stylex.props(styles.detailPane)}>
					{selectedGoal ? (
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
															styles[activity.state],
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
						</>
					) : (
						<div {...stylex.props(styles.detailEmpty)}>
							Select a goal to inspect output
						</div>
					)}
				</aside>
			</div>
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
						: styles.statusPaused,
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
	root: {
		backgroundColor: color.background,
		color: color.textMain,
		display: "flex",
		flexDirection: "column",
		height: "100%",
		minWidth: controlSize._0,
		overflow: "hidden",
	},
	body: {
		display: "grid",
		flex: 1,
		gridTemplateColumns: "minmax(280px, 0.9fr) minmax(320px, 1.1fr)",
		minHeight: controlSize._0,
		minWidth: controlSize._0,
	},
	list: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		overflowY: "auto",
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	listHeader: {
		alignItems: "center",
		color: color.textMuted,
		display: "grid",
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		gridTemplateColumns: "minmax(0, 1fr) auto",
		letterSpacing: 0,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		textTransform: "uppercase",
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
	goalRowSelected: {
		backgroundColor: color.controlActive,
		borderColor: color.borderStrong,
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
		minWidth: controlSize._0,
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
	emptyState: {
		alignItems: "center",
		color: color.textMuted,
		display: "flex",
		flexDirection: "column",
		fontSize: font.size_2,
		gap: controlSize._2,
		justifyContent: "center",
		minHeight: 220,
	},
	detailPane: {
		borderLeftColor: color.border,
		borderLeftStyle: "solid",
		borderLeftWidth: 1,
		display: "flex",
		flexDirection: "column",
		minHeight: controlSize._0,
		minWidth: controlSize._0,
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
		minWidth: controlSize._0,
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
		margin: controlSize._0,
	},
	outputSection: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		minHeight: controlSize._0,
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
		width: controlSize._0_25,
	},
	outputBody: {
		backgroundColor: color.surfaceTranslucent,
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		minWidth: controlSize._0,
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
		minWidth: controlSize._0,
	},
	outputEmpty: {
		color: color.textMuted,
		fontSize: font.size_2,
		paddingBlock: controlSize._8,
		textAlign: "center",
	},
	detailEmpty: {
		alignItems: "center",
		color: color.textMuted,
		display: "flex",
		flex: 1,
		fontSize: font.size_2,
		justifyContent: "center",
	},
});
