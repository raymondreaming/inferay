import { iconSize } from "@design-system/styles.stylex.ts";
import { ariaValue } from "@shared/lib/dom.tsx";
import { IconCheck, IconCopy } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { For, Match, Switch } from "solid-js";
import type { ChatMessage } from "../AgentChatView/types.ts";
import { useCopyText } from "../ChatRichContent/CopyButton.tsx";
import { AssistantMessagePart } from "./AssistantMessagePart.tsx";
import { BtwMessage } from "./BtwMessage.tsx";
import { SystemMessage } from "./SystemMessage.tsx";
import { styles } from "./styles.ts";
import { ToolMessage } from "./ToolMessage.tsx";
import { UserMessage } from "./UserMessage.tsx";
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
						<UserMessage
							message={_props.msg}
							slashCommandNames={_props.slashCommandNames}
						/>
					</Match>
					<Match when={_props.msg.role === "system"}>
						<SystemMessage
							message={_props.msg}
							onSendMessage={_props.onSendMessage}
							paneId={_props.paneId}
						/>
					</Match>
					<Match when={_props.msg.role === "btw"}>
						<BtwMessage
							message={_props.msg}
							onMdFileClick={_props.onMdFileClick}
						/>
					</Match>
					<Match when={_props.msg.role === "tool"}>
						<ToolMessage
							collapsed={_props.collapsed}
							message={_props.msg}
							onSendMessage={_props.onSendMessage}
							onToggle={_props.onToggle}
						/>
					</Match>
				</Switch>
			}
		</>
	);
};
