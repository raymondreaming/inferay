import type { ChatMessage } from "../../features/chat/agent-chat-shared.ts";

export type RenderChatMessage = Pick<
	ChatMessage,
	| "btwQuestion"
	| "content"
	| "id"
	| "images"
	| "isStreaming"
	| "role"
	| "toolName"
>;

export type RenderItem =
	| { type: "message"; message: RenderChatMessage }
	| { type: "edit-group"; filePath: string; edits: RenderChatMessage[] };

type AskUserQuestion = {
	question: string;
	header?: string;
	options?: Array<{ label: string; description?: string }>;
	multiSelect?: boolean;
};

function parseToolEnvelope(
	content: string
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

export function getToolTrailingOutput(content: string): string {
	const envelope = parseToolEnvelope(content);
	return envelope ? content.slice(envelope.end).trimStart() : "";
}

export function parseAskUserQuestions(
	content: string
): AskUserQuestion[] | null {
	const parsed = parseToolJson(content);
	if (!Array.isArray(parsed?.questions)) return null;
	return parsed.questions.filter(
		(question: unknown): question is AskUserQuestion =>
			!!question &&
			typeof question === "object" &&
			typeof (question as AskUserQuestion).question === "string"
	);
}

export function formatAskUserAnswer(
	questions: AskUserQuestion[],
	selections: Map<number, Set<number>>
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
	selections: Map<number, Set<number>>
) {
	return questions.every((_, qi) => !!selections.get(qi)?.size);
}

function fileNameFor(path: unknown) {
	if (typeof path !== "string" || !path) return undefined;
	return path.split("/").pop() || path;
}

function firstArraySummary(
	value: unknown,
	getPath: (item: unknown) => unknown = (item) => item
) {
	if (!Array.isArray(value) || value.length === 0) return null;
	const first = fileNameFor(getPath(value[0]));
	if (!first) return null;
	return value.length === 1 ? first : `${first} +${value.length - 1}`;
}

function firstChangeSummary(value: unknown) {
	if (!Array.isArray(value) || value.length === 0) return null;
	return (
		firstArraySummary(value, (item: any) =>
			typeof item === "string"
				? item
				: (item?.file_path ?? item?.path ?? item?.file)
		) ?? `${value.length} changes`
	);
}

export function getEditToolPayload(content: string): {
	filePath: string;
	oldString: string;
	newString: string;
} | null {
	const parsed = parseToolJson(content);
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

export function getToolOutputSummary(content: string) {
	const parsed = parseToolJson(content);
	const fileName = fileNameFor(parsed?.file_path);
	if (!parsed) return { type: "text", value: content };
	if (fileName && parsed.new_string !== undefined) {
		return { type: "edit", fileName, value: String(parsed.new_string) };
	}
	if (parsed.command || parsed.cmd) {
		return { type: "command", value: String(parsed.command ?? parsed.cmd) };
	}
	if (parsed.pattern) return { type: "pattern", value: String(parsed.pattern) };
	if (fileName && parsed.content) {
		const contentPreview = String(parsed.content);
		return {
			type: "file-content",
			fileName,
			value:
				contentPreview.length > 300
					? `${contentPreview.slice(0, 300)}...`
					: contentPreview,
		};
	}
	if (fileName) return { type: "accent", value: fileName };
	const pathFileName = fileNameFor(parsed.path ?? parsed.file);
	if (pathFileName) return { type: "accent", value: pathFileName };
	const files = firstArraySummary(parsed.files);
	if (files) return { type: "accent", value: files };
	const changes = firstChangeSummary(parsed.changes);
	if (changes) return { type: "accent", value: changes };
	if (parsed.glob || parsed.include) {
		return { type: "accent", value: String(parsed.glob || parsed.include) };
	}
	if (parsed.url) return { type: "url", value: String(parsed.url) };
	if (parsed.query) return { type: "accent", value: String(parsed.query) };
	const toolName =
		parsed.invocation &&
		typeof parsed.invocation === "object" &&
		"tool" in parsed.invocation
			? (parsed.invocation as { tool?: unknown }).tool
			: parsed.tool;
	if (toolName) return { type: "text", value: String(toolName) };
	if (parsed.skill) return { type: "text", value: `/${parsed.skill}` };
	if (parsed.prompt) return { type: "text", value: String(parsed.prompt) };
	return { type: "text", value: content };
}

export function getEditFilePath(msg: RenderChatMessage): string | null {
	if (msg.role !== "tool" || msg.toolName !== "Edit" || !msg.content)
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
		const filePath = getEditFilePath(msg);
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
				: { type: "message", message: msg }
		);
		i = j - 1;
	}

	return items;
}
