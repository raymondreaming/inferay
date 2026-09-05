import type {
	AskUserQuestion,
	ChatMessage,
	NativeToolDisplay,
	NativeToolSummary,
} from "../../../modules/conversation/model/agent-chat-shared.ts";

export type RenderChatMessage = Pick<
	ChatMessage,
	| "btwQuestion"
	| "content"
	| "id"
	| "images"
	| "isStreaming"
	| "role"
	| "toolName"
	| "render"
>;

export type RenderItem =
	| { type: "message"; message: RenderChatMessage }
	| { type: "edit-group"; filePath: string; edits: RenderChatMessage[] }
	| { type: "tool-group"; tools: RenderChatMessage[] };

export function formatAskUserAnswer(
	questions: AskUserQuestion[],
	selections: Map<number, Set<number>>,
) {
	const parts: string[] = [];
	for (let qi = 0; qi < questions.length; qi++) {
		const question = questions[qi]!;
		const selected = selections.get(qi);
		if (!selected?.size) continue;
		const labels = Array.from(selected)
			.sort()
			.flatMap((oi) => {
				const label = question.options?.[oi]?.label;
				return label ? [label] : [];
			});
		if (question.header)
			parts.push(`**${question.header}**: ${labels.join(", ")}`);
		else parts.push(labels.join(", "));
	}
	return parts.join("\n");
}

export function hasAskUserSelections(
	questions: AskUserQuestion[],
	selections: Map<number, Set<number>>,
) {
	return questions.every((_, qi) => !!selections.get(qi)?.size);
}

export function getEditToolPayload(parsed?: Record<string, unknown> | null): {
	filePath: string;
	oldString: string;
	newString: string;
} | null {
	if (
		typeof parsed?.file_path === "string" &&
		typeof parsed.old_string === "string" &&
		typeof parsed.new_string === "string"
	) {
		return {
			filePath: parsed.file_path,
			oldString: parsed.old_string,
			newString: parsed.new_string,
		};
	}
	return null;
}

/** Native descriptors own interpretation; unhydrated saved chats remain readable. */
export function getToolOutputSummary(
	content: string,
	nativeSummary?: NativeToolSummary | null,
): NativeToolSummary {
	return nativeSummary ?? { type: "text", value: content };
}

export function getToolDisplayInfo(
	toolName: string | undefined,
	nativeDisplay?: NativeToolDisplay,
): NativeToolDisplay {
	return (
		nativeDisplay ?? { label: toolName ? `Using ${toolName}` : "Running tool" }
	);
}

export function buildRenderItems(messages: RenderChatMessage[]): RenderItem[] {
	const items: RenderItem[] = [];
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]!;
		if (msg.render?.version === 1) {
			if (msg.render.hidden) continue;
			const group = [msg];
			if (msg.render.kind !== "message") {
				while (
					i + 1 < messages.length &&
					messages[i + 1]?.render?.groupId === msg.render.groupId
				) {
					const next = messages[++i]!;
					if (!next.render?.hidden) group.push(next);
				}
			}
			items.push(
				msg.render.kind === "tool-group"
					? { type: "tool-group", tools: group }
					: msg.render.kind === "edit-group" &&
							group.length > 1 &&
							msg.render.filePath
						? {
								type: "edit-group",
								filePath: msg.render.filePath,
								edits: group,
							}
						: { type: "message", message: msg },
			);
			continue;
		}
		const previousMessage = messages[i - 1];
		if (
			previousMessage &&
			previousMessage.role === msg.role &&
			previousMessage.toolName === msg.toolName &&
			previousMessage.content === msg.content
		) {
			continue;
		}
		const isTimelineTool =
			msg.role === "tool" &&
			msg.toolName !== "Edit" &&
			msg.toolName !== "AskUserQuestion";
		if (isTimelineTool) {
			const tools = [msg];
			let j = i + 1;
			while (j < messages.length) {
				const next = messages[j]!;
				if (
					next.role !== "tool" ||
					next.toolName === "Edit" ||
					next.toolName === "AskUserQuestion"
				)
					break;
				const previous = tools.at(-1)!;
				if (
					next.toolName !== previous.toolName ||
					next.content !== previous.content
				) {
					tools.push(next);
				}
				j++;
			}
			items.push({ type: "tool-group", tools });
			i = j - 1;
			continue;
		}
		items.push({ type: "message", message: msg });
	}

	return items;
}
