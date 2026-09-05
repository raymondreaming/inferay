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

function parseToolEnvelope(
	content: string,
): { parsed: Record<string, any>; end: number } | null {
	if (!content.trim().startsWith("{")) return null;
	try {
		const parsed = JSON.parse(content);
		return parsed && typeof parsed === "object"
			? { parsed, end: content.length }
			: null;
	} catch {}
	const start = content.indexOf("{");
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = start; index < content.length; index++) {
		const char = content[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') inString = true;
		else if (char === "{") depth++;
		else if (char === "}" && --depth === 0) {
			try {
				const parsed = JSON.parse(content.slice(start, index + 1));
				return parsed && typeof parsed === "object"
					? { parsed, end: index + 1 }
					: null;
			} catch {
				return null;
			}
		}
	}
	return null;
}

function parseToolJson(content: string): any {
	return parseToolEnvelope(content)?.parsed ?? null;
}

export function getToolTrailingOutput(
	content: string,
	nativeOutput?: string,
): string {
	if (nativeOutput !== undefined) return nativeOutput;
	const envelope = parseToolEnvelope(content);
	return envelope ? content.slice(envelope.end).trimStart() : "";
}

/** Older saved chats still need their interactive questions before native hydration. */
export function parseAskUserQuestions(
	content: string,
	nativeQuestions?: AskUserQuestion[] | null,
	nativeInput?: Record<string, unknown> | null,
): AskUserQuestion[] | null {
	if (nativeQuestions !== undefined) return nativeQuestions;
	const parsed =
		nativeInput === undefined ? parseToolJson(content) : nativeInput;
	if (!Array.isArray(parsed?.questions)) return null;
	return parsed.questions.flatMap((value: unknown): AskUserQuestion[] => {
		if (!value || typeof value !== "object") return [];
		const question = value as Record<string, unknown>;
		if (typeof question.question !== "string") return [];
		return [
			{
				question: question.question,
				header:
					typeof question.header === "string" ? question.header : undefined,
				multiSelect: question.multiSelect === true,
				options: Array.isArray(question.options)
					? question.options.flatMap((value: unknown) => {
							if (!value || typeof value !== "object") return [];
							const option = value as Record<string, unknown>;
							return typeof option.label === "string"
								? [
										{
											label: option.label,
											description:
												typeof option.description === "string"
													? option.description
													: undefined,
										},
									]
								: [];
						})
					: undefined,
			},
		];
	});
}

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

export function getEditToolPayload(
	content: string,
	nativeInput?: Record<string, unknown> | null,
): {
	filePath: string;
	oldString: string;
	newString: string;
} | null {
	const parsed =
		nativeInput === undefined ? parseToolJson(content) : nativeInput;
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

const editFilePathCache = new WeakMap<
	RenderChatMessage,
	{ content: string; filePath: string | null }
>();

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

export function getEditFilePath(msg: RenderChatMessage): string | null {
	if (msg.render?.version === 1) return msg.render.filePath ?? null;
	if (
		msg.role !== "tool" ||
		msg.toolName !== "Edit" ||
		msg.isStreaming ||
		!msg.content
	)
		return null;
	const cached = editFilePathCache.get(msg);
	if (cached?.content === msg.content) return cached.filePath;
	const filePath = getEditToolPayload(msg.content)?.filePath ?? null;
	editFilePathCache.set(msg, { content: msg.content, filePath });
	return filePath;
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
		const filePath = getEditFilePath(msg);
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
		if (!filePath) {
			items.push({ type: "message", message: msg });
			continue;
		}
		const edits: RenderChatMessage[] = [msg];
		let j = i + 1;

		while (j < messages.length) {
			const nextMsg = messages[j]!;
			const nextFilePath = getEditFilePath(nextMsg);
			if (nextFilePath === filePath) {
				edits.push(nextMsg);
				j++;
			} else {
				break;
			}
		}
		items.push(
			edits.length > 1
				? { type: "edit-group", filePath, edits }
				: { type: "message", message: msg },
		);
		i = j - 1;
	}

	return items;
}
