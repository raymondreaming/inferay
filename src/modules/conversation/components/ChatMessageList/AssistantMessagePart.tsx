import { SkillProposalCard } from "@skills/components/SkillProposalCard/index.tsx";
import { createMemo, Show } from "solid-js";
import type { ChatMessage } from "../AgentChatView/types.ts";
import { Markdown } from "../ChatRichContent/index.tsx";

/** Renders one streamed text or skill-proposal segment of an assistant message. */
export function AssistantMessagePart(props: {
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
