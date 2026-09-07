import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { DotMatrixRipple } from "../../../../shared/ui/DotMatrixLoader/index.tsx";
import {
	IconAlertTriangle,
	IconCheck,
	IconTarget,
} from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";

function goalStatusLabel(status: GoalSystemMessage["status"]) {
	if (status === "active") return "Pursuing Goal";
	if (status === "paused") return "Goal Paused";
	if (status === "complete") return "Goal Achieved";
	if (status === "cleared") return "Goal Cleared";
	return "No Active Goal";
}
export function GoalSystemCard(_props: { goal: GoalSystemMessage }) {
	const turnsLabel = createMemo(() =>
		typeof _props.goal.turns === "number"
			? `${_props.goal.turns} turn${_props.goal.turns === 1 ? "" : "s"}`
			: null,
	);
	return (
		<div
			{...stylex.attrs(
				styles.goalCard,
				_props.goal.status === "active" && styles.goalCardActive,
				_props.goal.status === "paused" && styles.goalCardPaused,
				_props.goal.status === "complete" && styles.goalCardComplete,
			)}
		>
			<span
				{...stylex.attrs(
					styles.goalIconSlot,
					_props.goal.status === "active" && styles.goalIconActive,
					_props.goal.status === "paused" && styles.goalIconPaused,
					_props.goal.status === "complete" && styles.goalIconComplete,
				)}
			>
				{_props.goal.status === "active" ? (
					<DotMatrixRipple
						dotSize={1.35}
						gap={1}
						speed={1.1}
						ariaLabel="Goal running"
					/>
				) : _props.goal.status === "complete" ? (
					<IconCheck size={iconSize.md} />
				) : _props.goal.status === "paused" ? (
					<IconAlertTriangle size={iconSize.md} />
				) : (
					<IconTarget size={iconSize.md} />
				)}
			</span>
			<div {...stylex.attrs(styles.goalCardBody)}>
				<div {...stylex.attrs(styles.goalCardHeader)}>
					<span {...stylex.attrs(styles.goalCardTitle)}>
						{goalStatusLabel(_props.goal.status)}
					</span>
					{turnsLabel() && (
						<span {...stylex.attrs(styles.goalTurns)}>{turnsLabel()}</span>
					)}
				</div>
				{_props.goal.objective && (
					<div {...stylex.attrs(styles.goalObjective)}>
						{_props.goal.objective}
					</div>
				)}
				{_props.goal.detail && (
					<div {...stylex.attrs(styles.goalDetail)}>{_props.goal.detail}</div>
				)}
			</div>
		</div>
	);
}
type GoalSystemStatus = "active" | "paused" | "complete" | "cleared" | "empty";
export type GoalSystemMessage = {
	type: "inferay.goal";
	status: GoalSystemStatus;
	objective?: string;
	turns?: number;
	detail?: string;
};
