import { iconSize } from "@design-system/styles.stylex.ts";
import { IconChevronDown } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, Match, Switch } from "solid-js";
import type { ChatMessage } from "../AgentChatView/types.ts";
import { MiniEditDiff } from "../ChatEditDiff/index.tsx";
import {
	AskUserQuestionCard,
	CopyButton,
	McpElicitationCard,
} from "../ChatRichContent/index.tsx";
import { styles } from "./styles.ts";
import { ToolOutputHighlight } from "./ToolOutputHighlight.tsx";
import { getToolDisplayInfo } from "./ToolTimeline.tsx";

/** Selects specialized tool cards and owns the generic expandable tool output. */
export function ToolMessage(props: {
	collapsed: boolean;
	message: ChatMessage;
	onSendMessage?: (text: string) => void;
	onToggle: (id: string) => void;
}) {
	const display = createMemo(() =>
		getToolDisplayInfo(props.message.toolName, props.message.render?.display),
	);
	const editPayload = createMemo(() => props.message.render?.edit);
	return (
		<Switch
			fallback={
				<div>
					<button
						type="button"
						onClick={() => props.onToggle(props.message.id)}
						{...stylex.attrs(styles.toolToggle)}
					>
						<span {...stylex.attrs(styles.toolName)}>{display().label}</span>
						{props.collapsed && display().detail && (
							<span {...stylex.attrs(styles.toolSummary)}>
								{display().detail}
							</span>
						)}
						<IconChevronDown
							size={iconSize.micro}
							{...stylex.attrs(
								styles.toolMilestoneChevron,
								props.collapsed && styles.rotateClosed,
							)}
						/>
					</button>
					{!props.collapsed && props.message.content && (
						<div {...stylex.attrs(styles.toolOutputWrap)}>
							<pre {...stylex.attrs(styles.toolOutput)}>
								<ToolOutputHighlight
									render={props.message.render}
									content={props.message.content}
								/>
							</pre>
							<div {...stylex.attrs(styles.toolCopyOverlay)}>
								<CopyButton text={props.message.content} />
							</div>
						</div>
					)}
				</div>
			}
		>
			<Match
				when={
					props.message.toolName === "McpElicitation" &&
					props.message.render?.elicitation
				}
			>
				{(elicitation) => (
					<McpElicitationCard
						elicitation={elicitation()}
						isStreaming={props.message.isStreaming}
						onSendMessage={props.onSendMessage}
					/>
				)}
			</Match>
			<Match when={props.message.toolName === "AskUserQuestion"}>
				<AskUserQuestionCard
					nativeQuestions={props.message.render?.questions}
					content={props.message.content}
					isStreaming={props.message.isStreaming}
					onSendMessage={props.onSendMessage}
				/>
			</Match>
			<Match when={!!editPayload() && !props.message.isStreaming}>
				<MiniEditDiff
					oldStr={editPayload()!.old_string}
					newStr={editPayload()!.new_string}
					filePath={editPayload()!.file_path}
					isStreaming={props.message.isStreaming}
				/>
			</Match>
		</Switch>
	);
}
