import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { DotMatrixRipple } from "../../../../shared/ui/DotMatrixLoader/index.tsx";
import {
	IconAlertTriangle,
	IconCheck,
	IconTarget,
} from "../../../../shared/ui/Icons/index.tsx";
import type { GoalSystemMessage } from "../../model/agent-chat-shared.ts";
import { styles } from "./styles.ts";

function goalStatusLabel(status: GoalSystemMessage["status"]) {
	if (status === "active") return "Pursuing Goal";
	if (status === "paused") return "Goal Paused";
	if (status === "complete") return "Goal Achieved";
	if (status === "cleared") return "Goal Cleared";
	return "No Active Goal";
}

export function GoalSystemCard({ goal }: { goal: GoalSystemMessage }) {
	const turnsLabel =
		typeof goal.turns === "number"
			? `${goal.turns} turn${goal.turns === 1 ? "" : "s"}`
			: null;
	return (
		<div
			{...stylex.props(
				styles.goalCard,
				goal.status === "active" && styles.goalCardActive,
				goal.status === "paused" && styles.goalCardPaused,
				goal.status === "complete" && styles.goalCardComplete,
			)}
		>
			<span
				{...stylex.props(
					styles.goalIconSlot,
					goal.status === "active" && styles.goalIconActive,
					goal.status === "paused" && styles.goalIconPaused,
					goal.status === "complete" && styles.goalIconComplete,
				)}
			>
				{goal.status === "active" ? (
					<DotMatrixRipple
						dotSize={1.35}
						gap={1}
						speed={1.1}
						ariaLabel="Goal running"
					/>
				) : goal.status === "complete" ? (
					<IconCheck size={iconSize.md} />
				) : goal.status === "paused" ? (
					<IconAlertTriangle size={iconSize.md} />
				) : (
					<IconTarget size={iconSize.md} />
				)}
			</span>
			<div {...stylex.props(styles.goalCardBody)}>
				<div {...stylex.props(styles.goalCardHeader)}>
					<span {...stylex.props(styles.goalCardTitle)}>
						{goalStatusLabel(goal.status)}
					</span>
					{turnsLabel && (
						<span {...stylex.props(styles.goalTurns)}>{turnsLabel}</span>
					)}
				</div>
				{goal.objective && (
					<div {...stylex.props(styles.goalObjective)}>{goal.objective}</div>
				)}
				{goal.detail && (
					<div {...stylex.props(styles.goalDetail)}>{goal.detail}</div>
				)}
			</div>
		</div>
	);
}
