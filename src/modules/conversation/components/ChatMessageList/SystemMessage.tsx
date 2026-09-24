import type { CommandCard, GoalCard } from "@contracts";
import { iconSize } from "@design-system/styles.stylex.ts";
import { DotMatrixRipple } from "@shared/ui/DotMatrixLoader/index.tsx";
import {
	IconAlertTriangle,
	IconCheck,
	IconTarget,
} from "@shared/ui/Icons/index.tsx";
import {
	SkillProposalCard,
	SkillReadCard,
} from "@skills/components/SkillProposalCard/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, Match, Switch } from "solid-js";
import type { ChatMessage } from "../AgentChatView/useChatConnection.tsx";
import { styles } from "./styles.ts";

type SubagentCardView = {
	status: string;
	title: string;
	profile?: string | null;
	workerId?: string | null;
	detail?: string | null;
	activeLabel?: string | null;
};

/** Selects the specialized card for a system message's native rendering data. */
export function SystemMessage(props: {
	message: ChatMessage;
	onSendMessage?: (text: string) => void;
	paneId: string;
}) {
	const skillProposal = createMemo(() => props.message.render?.skillProposal);
	const skillRead = createMemo(() => props.message.render?.skillRead);
	const goalMessage = createMemo(() => props.message.render?.goal);
	const subagentMessage = createMemo(
		() =>
			(
				props.message.render as
					| { subagent?: SubagentCardView }
					| null
					| undefined
			)?.subagent,
	);
	const commandMessage = createMemo(() => props.message.render?.command);
	return (
		<Switch
			fallback={
				<p {...stylex.attrs(styles.systemText)}>{props.message.content}</p>
			}
		>
			<Match when={!!skillProposal()}>
				<SkillProposalCard
					proposal={skillProposal()!}
					messageId={`${props.paneId}:${props.message.id}:native`}
					onResult={props.onSendMessage}
				/>
			</Match>
			<Match when={!!skillRead()}>
				<SkillReadCard skill={skillRead()!} />
			</Match>
			<Match when={!!goalMessage()}>
				<GoalSystemCard goal={goalMessage()!} />
			</Match>
			<Match when={!!subagentMessage()}>
				<SubagentSystemCard subagent={subagentMessage()!} />
			</Match>
			<Match when={!!commandMessage()}>
				<CommandSystemCard command={commandMessage()!} />
			</Match>
		</Switch>
	);
}

function GoalSystemCard(_props: { goal: GoalCard }) {
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
						{_props.goal.title}
					</span>
					{_props.goal.turnsLabel && (
						<span {...stylex.attrs(styles.goalTurns)}>
							{_props.goal.turnsLabel}
						</span>
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

function SubagentSystemCard(_props: { subagent: SubagentCardView }) {
	const active =
		_props.subagent.status === "running" || _props.subagent.status === "on";
	const failed =
		_props.subagent.status === "failed" ||
		_props.subagent.status === "cancelled";
	const complete = _props.subagent.status === "completed";
	return (
		<div
			{...stylex.attrs(
				styles.goalCard,
				active && styles.goalCardActive,
				failed && styles.goalCardPaused,
				complete && styles.goalCardComplete,
			)}
		>
			<span
				{...stylex.attrs(
					styles.goalIconSlot,
					active && styles.goalIconActive,
					failed && styles.goalIconPaused,
					complete && styles.goalIconComplete,
				)}
			>
				{active ? (
					<DotMatrixRipple
						dotSize={1.35}
						gap={1}
						speed={1.1}
						ariaLabel="Subagent running"
					/>
				) : complete ? (
					<IconCheck size={iconSize.md} />
				) : failed ? (
					<IconAlertTriangle size={iconSize.md} />
				) : (
					<IconTarget size={iconSize.md} />
				)}
			</span>
			<div {...stylex.attrs(styles.goalCardBody)}>
				<div {...stylex.attrs(styles.goalCardHeader)}>
					<span {...stylex.attrs(styles.goalCardTitle)}>
						{_props.subagent.title}
					</span>
					{_props.subagent.activeLabel && (
						<span {...stylex.attrs(styles.goalTurns)}>
							{_props.subagent.activeLabel}
						</span>
					)}
					{_props.subagent.profile && (
						<span {...stylex.attrs(styles.goalTurns)}>
							{_props.subagent.profile}
						</span>
					)}
				</div>
				{_props.subagent.detail && (
					<div {...stylex.attrs(styles.goalDetail)}>{_props.subagent.detail}</div>
				)}
				{_props.subagent.workerId && (
					<div {...stylex.attrs(styles.goalDetail)}>
						{_props.subagent.workerId}
					</div>
				)}
			</div>
		</div>
	);
}

function CommandSystemCard(_props: { command: CommandCard }) {
	return (
		<div {...stylex.attrs(styles.goalCard, styles.goalCardActive)}>
			<span {...stylex.attrs(styles.goalIconSlot, styles.goalIconActive)}>
				<DotMatrixRipple
					dotSize={1.35}
					gap={1}
					speed={1.1}
					ariaLabel="Command running"
				/>
			</span>
			<div {...stylex.attrs(styles.goalCardBody)}>
				<div {...stylex.attrs(styles.goalCardHeader)}>
					<span {...stylex.attrs(styles.goalCardTitle)}>Running Command</span>
				</div>
				<div {...stylex.attrs(styles.commandObjective)}>
					{_props.command.label}
				</div>
				{_props.command.description && (
					<div {...stylex.attrs(styles.goalDetail)}>
						{_props.command.description}
					</div>
				)}
			</div>
		</div>
	);
}
