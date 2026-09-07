import * as stylex from "@stylexjs/stylex";
import { createMemo, For, Match, Show, Switch } from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { ariaValue } from "../../../../shared/lib/dom.tsx";
import { project as rustProject } from "../../../../shared/lib/native.tsx";
import {
	IconCheck,
	IconChevronDown,
	IconCopy,
} from "../../../../shared/ui/Icons/index.tsx";
import {
	SkillProposalCard,
	SkillReadCard,
} from "../../../skills/components/SkillProposalCard/index.tsx";
import type { ChatMessage } from "../AgentChatView/useChatConnection.tsx";
import { MiniEditDiff } from "../ChatEditDiff/index.tsx";
import { useCopyText } from "../ChatRichContent/CopyButton.tsx";
import {
	AskUserQuestionCard,
	CopyButton,
	Markdown,
} from "../ChatRichContent/index.tsx";
import { DecoratedText } from "../ChatTokenDecorators/index.tsx";
import { CommandSystemCard } from "./CommandSystemCard.tsx";
import { GoalSystemCard } from "./GoalSystemCard.tsx";
import { styles } from "./styles.ts";
import { ToolOutputHighlight } from "./ToolOutputHighlight.tsx";
import { getToolDisplayInfo } from "./ToolTimeline.tsx";
export const Bubble = function Bubble(_props: {
	paneId: string;
	msg: ChatMessage;
	collapsed: boolean;
	onToggle: (id: string) => void;
	onSendMessage?: (text: string) => void;
	onMdFileClick?: (path: string) => void;
	slashCommandNames: readonly string[];
}) {
	const _source = useCopyText(
		() => _props.msg.content,
		() => true,
	);
	const skillProposal = createMemo(() => _props.msg.render?.skillProposal);
	const skillRead = createMemo(() => _props.msg.render?.skillRead);
	const goalMessage = createMemo(() => _props.msg.render?.goal);
	const commandMessage = createMemo(() => _props.msg.render?.command);
	const display = createMemo(() =>
		getToolDisplayInfo(_props.msg.toolName, _props.msg.render?.display),
	);
	const editPayload = createMemo(() => _props.msg.render?.edit);
	const userMessageDisplay = createMemo(() =>
		getUserMessagePresentation(_props.msg, _props.slashCommandNames),
	);
	return (
		<>
			{
				<Switch
					fallback={
						<div {...stylex.attrs(styles.assistantMessage)}>
							{
								<For
									each={
										_props.msg.render?.skillParts ?? [
											{
												start: 0,
												end: _props.msg.content.length,
											},
										]
									}
									keyed={(row) =>
										"start" in row
											? `text:${row.start}`
											: "proposal" in row
												? `proposal:${row.index}`
												: "pending"
									}
								>
									{(part) => (
										<AssistantMessagePart
											part={part()}
											msg={_props.msg}
											paneId={_props.paneId}
											onSendMessage={_props.onSendMessage}
											onMdFileClick={_props.onMdFileClick}
										/>
									)}
								</For>
							}
							{!_props.msg.isStreaming && _props.msg.content.trim() ? (
								<div {...stylex.attrs(styles.messageActionRow)}>
									<button
										type="button"
										onClick={_source.handleCopy}
										title={_source.copied ? "Copied" : "Copy message"}
										aria-label={ariaValue(
											_source.copied ? "Copied message" : "Copy message",
										)}
										{...stylex.attrs(
											styles.copyMessageButton,
											_source.copied && styles.copyMessageButtonCopied,
										)}
									>
										{_source.copied ? (
											<IconCheck size={iconSize.compact} />
										) : (
											<IconCopy size={iconSize.compact} />
										)}
										<span>{_source.copied ? "Copied" : "Copy"}</span>
									</button>
								</div>
							) : null}
						</div>
					}
				>
					<Match when={_props.msg.role === "user"}>
						<div {...stylex.attrs(styles.userRow)}>
							<div {...stylex.attrs(styles.userBubble)}>
								{userMessageDisplay() &&
									userMessageDisplay()!.imagePaths.length > 0 && (
										<div {...stylex.attrs(styles.userImages)}>
											{
												<For
													each={userMessageDisplay()!.imagePaths}
													keyed={(row) => row}
												>
													{(imgPath, index) => (
														<span
															{...stylex.attrs(
																styles.userImageFrame,
																index() % 2 === 1 && styles.userImageFrameAlt,
															)}
														>
															<img
																src={`/api/file?path=${encodeURIComponent(imgPath())}`}
																alt=""
																{...stylex.attrs(styles.userImage)}
															/>
														</span>
													)}
												</For>
											}
										</div>
									)}
								{userMessageDisplay() && userMessageDisplay()!.content && (
									<p {...stylex.attrs(styles.userText)}>
										<DecoratedText
											text={userMessageDisplay()!.content}
											slashCommandNames={_props.slashCommandNames}
											pills
										/>
									</p>
								)}
							</div>
						</div>
					</Match>
					<Match when={_props.msg.role === "system"}>
						<Switch
							fallback={
								<p {...stylex.attrs(styles.systemText)}>{_props.msg.content}</p>
							}
						>
							<Match when={!!skillProposal()}>
								<SkillProposalCard
									proposal={skillProposal()!}
									messageId={`${_props.paneId}:${_props.msg.id}:native`}
									onResult={_props.onSendMessage}
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
					</Match>
					<Match when={_props.msg.role === "btw"}>
						<div {...stylex.attrs(styles.btwCard)}>
							<div {...stylex.attrs(styles.btwHeader)}>
								<span {...stylex.attrs(styles.btwLabel)}>btw</span>
								{_props.msg.btwQuestion && (
									<span {...stylex.attrs(styles.btwQuestion)}>
										- {_props.msg.btwQuestion}
									</span>
								)}
							</div>
							<div {...stylex.attrs(styles.btwBody)}>
								{_props.msg.content ? (
									<Markdown
										text={_props.msg.content}
										onMdFileClick={_props.onMdFileClick}
										streaming={_props.msg.isStreaming}
									/>
								) : _props.msg.isStreaming ? (
									<div {...stylex.attrs(styles.btwDots)}>
										<span {...stylex.attrs(styles.smallDot)} />
										<span {...stylex.attrs(styles.smallDot, styles.dot2)} />
										<span {...stylex.attrs(styles.smallDot, styles.dot3)} />
									</div>
								) : null}
							</div>
						</div>
					</Match>
					<Match when={_props.msg.role === "tool"}>
						<Switch
							fallback={
								<div>
									<button
										type="button"
										onClick={() => _props.onToggle(_props.msg.id)}
										{...stylex.attrs(styles.toolToggle)}
									>
										<span {...stylex.attrs(styles.toolName)}>
											{display().label}
										</span>
										{_props.collapsed && display().detail && (
											<span {...stylex.attrs(styles.toolSummary)}>
												{display().detail}
											</span>
										)}
										<IconChevronDown
											size={iconSize.micro}
											{...stylex.attrs(
												styles.toolMilestoneChevron,
												_props.collapsed && styles.rotateClosed,
											)}
										/>
									</button>
									{!_props.collapsed && _props.msg.content && (
										<div {...stylex.attrs(styles.toolOutputWrap)}>
											<pre {...stylex.attrs(styles.toolOutput)}>
												<ToolOutputHighlight
													render={_props.msg.render}
													content={_props.msg.content}
												/>
											</pre>
											<div {...stylex.attrs(styles.toolCopyOverlay)}>
												<CopyButton text={_props.msg.content} />
											</div>
										</div>
									)}
								</div>
							}
						>
							<Match when={_props.msg.toolName === "AskUserQuestion"}>
								<AskUserQuestionCard
									nativeQuestions={_props.msg.render?.questions}
									content={_props.msg.content}
									isStreaming={_props.msg.isStreaming}
									onSendMessage={_props.onSendMessage}
								/>
							</Match>
							<Match when={!!editPayload() && !_props.msg.isStreaming}>
								<MiniEditDiff
									oldStr={editPayload()!.old_string}
									newStr={editPayload()!.new_string}
									filePath={editPayload()!.file_path}
									isStreaming={_props.msg.isStreaming}
								/>
							</Match>
						</Switch>
					</Match>
				</Switch>
			}
		</>
	);
};
export function getUserMessagePresentation(
	message: ChatMessage,
	slashCommandNames: readonly string[],
): {
	content: string;
	imagePaths: string[];
} | null {
	return rustProject("userMessage", {
		message,
		commands: slashCommandNames,
	});
}

function AssistantMessagePart(props: {
	part: NonNullable<NonNullable<ChatMessage["render"]>["skillParts"]>[number];
	msg: ChatMessage;
	paneId: string;
	onSendMessage?: (text: string) => void;
	onMdFileClick?: (path: string) => void;
}) {
	const text = createMemo(() => ("start" in props.part ? props.part : null));
	const proposal = createMemo(() =>
		"proposal" in props.part ? props.part : null,
	);
	return (
		<Show
			when={text()}
			fallback={
				<Show when={proposal()} fallback={<p>Preparing skill proposal…</p>}>
					{(value) => (
						<SkillProposalCard
							messageId={`${props.paneId}:${props.msg.id}:${value().index}`}
							proposal={value().proposal}
							streaming={props.msg.isStreaming}
							onResult={props.onSendMessage}
						/>
					)}
				</Show>
			}
		>
			{(range) => (
				<Markdown
					text={props.msg.content.slice(range().start, range().end)}
					onMdFileClick={props.onMdFileClick}
					streaming={props.msg.isStreaming}
				/>
			)}
		</Show>
	);
}
