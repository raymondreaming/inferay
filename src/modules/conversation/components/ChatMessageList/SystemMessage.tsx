import {
	SkillProposalCard,
	SkillReadCard,
} from "@skills/components/SkillProposalCard/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, Match, Switch } from "solid-js";
import type { ChatMessage } from "../AgentChatView/useChatConnection.tsx";
import { CommandSystemCard } from "./CommandSystemCard.tsx";
import { GoalSystemCard } from "./GoalSystemCard.tsx";
import { styles } from "./styles.ts";

/** Selects the specialized card for a system message's native rendering data. */
export function SystemMessage(props: {
	message: ChatMessage;
	onSendMessage?: (text: string) => void;
	paneId: string;
}) {
	const skillProposal = createMemo(() => props.message.render?.skillProposal);
	const skillRead = createMemo(() => props.message.render?.skillRead);
	const goalMessage = createMemo(() => props.message.render?.goal);
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
			<Match when={!!commandMessage()}>
				<CommandSystemCard command={commandMessage()!} />
			</Match>
		</Switch>
	);
}
