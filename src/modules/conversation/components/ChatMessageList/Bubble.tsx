import * as stylex from "@stylexjs/stylex";
import { createMemo, For } from "solid-js";
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
import { renderTextPills } from "../ChatTokenDecorators/index.tsx";
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
	const editPayload = createMemo(() => _props.msg.render?.edit);
	const userMessageDisplay = createMemo(() => {
		const display = getUserMessagePresentation(
			_props.msg,
			_props.slashCommandNames,
		);
		if (!display) return null;
		return {
			contentNodes: display.content
				? renderTextPills(display.content, _props.slashCommandNames)
				: null,
			imagePaths: display.imagePaths,
		};
	});
	return (
		<>
			{(() => {
				const _editPayloadValue = editPayload();
				if (_props.msg.role === "user") {
					return (
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
								{userMessageDisplay() && userMessageDisplay()!.contentNodes && (
									<p {...stylex.attrs(styles.userText)}>
										{userMessageDisplay()!.contentNodes}
									</p>
								)}
							</div>
						</div>
					);
				}
				if (_props.msg.role === "system") {
					const skillProposal = _props.msg.render?.skillProposal;
					if (skillProposal)
						return (
							<SkillProposalCard
								proposal={skillProposal}
								messageId={`${_props.paneId}:${_props.msg.id}:native`}
								onResult={_props.onSendMessage}
							/>
						);
					const skillRead = _props.msg.render?.skillRead;
					if (skillRead) return <SkillReadCard skill={skillRead} />;
					const goalMessage = _props.msg.render?.goal;
					if (goalMessage) return <GoalSystemCard goal={goalMessage} />;
					const commandMessage = _props.msg.render?.command;
					if (commandMessage)
						return <CommandSystemCard command={commandMessage} />;
					return (
						<p {...stylex.attrs(styles.systemText)}>{_props.msg.content}</p>
					);
				}
				if (_props.msg.role === "btw") {
					return (
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
					);
				}
				if (_props.msg.role === "tool") {
					if (_props.msg.toolName === "AskUserQuestion") {
						return (
							<AskUserQuestionCard
								nativeQuestions={_props.msg.render?.questions}
								content={_props.msg.content}
								isStreaming={_props.msg.isStreaming}
								onSendMessage={_props.onSendMessage}
							/>
						);
					}
					if (_editPayloadValue && !_props.msg.isStreaming) {
						return (
							<MiniEditDiff
								oldStr={_editPayloadValue.old_string}
								newStr={_editPayloadValue.new_string}
								filePath={_editPayloadValue.file_path}
								isStreaming={_props.msg.isStreaming}
							/>
						);
					}
					const display = getToolDisplayInfo(
						_props.msg.toolName,
						_props.msg.render?.display,
					);
					return (
						<div>
							<button
								type="button"
								onClick={() => _props.onToggle(_props.msg.id)}
								{...stylex.attrs(styles.toolToggle)}
							>
								<span {...stylex.attrs(styles.toolName)}>{display.label}</span>
								{_props.collapsed && display.detail && (
									<span {...stylex.attrs(styles.toolSummary)}>
										{display.detail}
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
					);
				}
				return (
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
									<>
										{(() => {
											const value = part();
											return "proposal" in value ? (
												<SkillProposalCard
													messageId={`${_props.paneId}:${_props.msg.id}:${value.index}`}
													proposal={value.proposal}
													streaming={_props.msg.isStreaming}
													onResult={_props.onSendMessage}
												/>
											) : "pending" in value ? (
												<p>Preparing skill proposal…</p>
											) : (
												<Markdown
													text={_props.msg.content.slice(
														value.start,
														value.end,
													)}
													onMdFileClick={_props.onMdFileClick}
													streaming={_props.msg.isStreaming}
												/>
											);
										})()}
									</>
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
				);
			})()}
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
