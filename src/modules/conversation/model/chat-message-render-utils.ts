import type { ChatMessage } from "../../../modules/conversation/model/agent-chat-shared.ts";

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

type AskUserQuestion = {
	question: string;
	header?: string;
	options?: Array<{ label: string; description?: string }>;
	multiSelect?: boolean;
};

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

export function parseAskUserQuestions(
	content: string,
	nativeInput?: Record<string, unknown> | null,
): AskUserQuestion[] | null {
	const parsed =
		nativeInput === undefined ? parseToolJson(content) : nativeInput;
	if (!Array.isArray(parsed?.questions)) return null;
	return parsed.questions.filter(
		(question: unknown): question is AskUserQuestion =>
			!!question &&
			typeof question === "object" &&
			typeof (question as AskUserQuestion).question === "string",
	);
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

function fileNameFor(path: unknown) {
	if (typeof path !== "string" || !path) return undefined;
	return path.split("/").pop() || path;
}

function firstArraySummary(
	value: unknown,
	getPath: (item: unknown) => unknown = (item) => item,
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
				: (item?.file_path ?? item?.path ?? item?.file),
		) ?? `${value.length} changes`
	);
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

export function getToolOutputSummary(
	content: string,
	nativeInput?: Record<string, unknown> | null,
) {
	const parsed =
		nativeInput === undefined ? parseToolJson(content) : nativeInput;
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

export type ToolDisplayInfo = {
	label: string;
	detail?: string;
};

function commandFromToolContent(
	content: string,
	nativeInput?: Record<string, unknown> | null,
): string | null {
	const parsed =
		nativeInput === undefined ? parseToolJson(content) : nativeInput;
	const command = parsed?.command ?? parsed?.cmd;
	return typeof command === "string" && command.trim() ? command.trim() : null;
}

function commandDetail(command: string, fallback: string) {
	const unwrapped = command
		.replace(/^\s*\/bin\/(?:zsh|bash|sh)\s+-lc\s+/, "")
		.replace(/^['"]|['"]$/g, "")
		.trim();
	return unwrapped || fallback;
}

function commandTarget(command: string): string | undefined {
	const matches = command.match(
		/(?:^|\s)([^\s'"|;&]+\.(?:ts|tsx|js|jsx|json|md|css|scss|py|rs|go|java|kt|swift|rb|php|sql|ya?ml|toml))(?:\s|$)/g,
	);
	const candidate = matches?.at(-1)?.trim();
	return candidate ? fileNameFor(candidate) : undefined;
}

/** Convert implementation-level tool input into a user-facing milestone. */
export function getToolDisplayInfo(
	toolName: string | undefined,
	content: string,
	nativeInput?: Record<string, unknown> | null,
): ToolDisplayInfo {
	const normalized = toolName?.trim().toLowerCase() ?? "";
	const command = commandFromToolContent(content, nativeInput);
	if (command) {
		const value = command.toLowerCase();
		const target = commandTarget(command);
		const verificationKinds = [
			/\b(?:npm|bun|pnpm|yarn)\s+(?:run\s+)?(?:test|vitest)\b|\b(?:vitest|jest|pytest)\b/,
			/\b(?:tsc|typecheck|type-check|mypy|pyright)\b/,
			/\b(?:eslint|ruff|clippy|golangci-lint|biome\s+(?:check|lint)|npm\s+run\s+lint)\b/,
			/\b(?:npm|bun|pnpm|yarn)\s+(?:run\s+)?build\b|\b(?:cargo|go)\s+build\b/,
		].filter((pattern) => pattern.test(value)).length;
		if (verificationKinds > 1) return { label: "Running verification checks" };
		if (
			/\b(?:npm|bun|pnpm|yarn)\s+(?:run\s+)?(?:test|vitest)\b|\bvitest\b/.test(
				value,
			)
		)
			return {
				label: target ? `Testing ${target}` : "Running JavaScript tests",
			};
		if (/\bpytest\b|\bpython(?:3)?\s+-m\s+(?:pytest|unittest)\b/.test(value))
			return { label: target ? `Testing ${target}` : "Running Python tests" };
		if (/\bcargo\s+test\b/.test(value)) return { label: "Running Rust tests" };
		if (/\bgo\s+test\b/.test(value)) return { label: "Running Go tests" };
		if (/\b(?:tsc|typecheck|type-check)\b/.test(value))
			return { label: "Type-checking project" };
		if (/\b(?:mypy|pyright)\b/.test(value))
			return { label: "Checking Python types" };
		if (/\b(?:eslint|npm\s+run\s+lint)\b/.test(value))
			return { label: target ? `Linting ${target}` : "Linting project" };
		if (/\bbiome\s+(?:check|lint)\b/.test(value))
			return { label: "Checking code style" };
		if (/\b(?:ruff|pylint|flake8)\b/.test(value))
			return { label: "Linting Python code" };
		if (/\b(?:cargo\s+clippy|golangci-lint)\b/.test(value))
			return { label: "Analyzing code" };
		if (/\b(?:npm|bun|pnpm|yarn)\s+(?:run\s+)?build\b/.test(value))
			return { label: "Building application" };
		if (/\bcargo\s+(?:build|check)\b/.test(value))
			return { label: "Checking Rust project" };
		if (/\bgo\s+build\b/.test(value)) return { label: "Building Go project" };
		if (/\b(?:prettier|biome\s+format)\b/.test(value))
			return { label: "Formatting code" };
		if (/\bgit\s+status\b/.test(value))
			return { label: "Checking working tree" };
		if (/\bgit\s+log\b/.test(value))
			return {
				label: /(?:^|\s)-(?:1|n\s*1)(?:\s|$)/.test(value)
					? "Reading latest commit"
					: "Reading commit history",
			};
		if (/\bgit\s+diff\b/.test(value))
			return {
				label: /--cached|--staged/.test(value)
					? target
						? `Reviewing staged ${target}`
						: "Reviewing staged changes"
					: target
						? `Reviewing changes in ${target}`
						: "Reviewing working changes",
			};
		if (/\bgit\s+show\b/.test(value))
			return {
				label: target ? `Reading committed ${target}` : "Inspecting commit",
			};
		if (/\bgit\s+(?:branch|rev-parse)\b/.test(value))
			return { label: "Identifying current revision" };
		if (/\bgit\s+blame\b/.test(value))
			return {
				label: target ? `Tracing ${target} history` : "Tracing line history",
			};
		if (/\bgit\s+(?:fetch|pull)\b/.test(value))
			return { label: "Refreshing remote changes" };
		if (/\bgit\s+push\b/.test(value)) return { label: "Publishing commits" };
		if (/\bgit\s+(?:checkout|switch)\b/.test(value))
			return { label: "Switching branch" };
		if (/\bgit\s+(?:add|commit)\b/.test(value))
			return {
				label: /\bcommit\b/.test(value) ? "Saving changes" : "Staging changes",
			};
		if (/\b(?:rg|grep)\b/.test(value))
			return {
				label: target ? `Searching ${target}` : "Searching source code",
			};
		if (/\bfind\b/.test(value)) return { label: "Discovering files" };
		if (/\b(?:sed|cat|head|tail|less)\b/.test(value))
			return { label: target ? `Reading ${target}` : "Reading source excerpt" };
		if (/\b(?:ls|tree)\b/.test(value))
			return { label: "Listing project files" };
		if (/\bpwd\b/.test(value)) return { label: "Checking current location" };
		if (/\b(?:npm|bun|pnpm|yarn)\s+(?:install|add)\b/.test(value))
			return { label: "Installing dependencies" };
		if (/\b(?:docker|docker-compose)\s+(?:build|compose\s+build)\b/.test(value))
			return { label: "Building containers" };
		if (/\b(?:docker|docker-compose)\s+(?:run|up|compose\s+up)\b/.test(value))
			return { label: "Starting containers" };
		if (
			/\b(?:prisma|drizzle|rails|alembic)\b.*\b(?:migrate|migration)\b/.test(
				value,
			)
		)
			return { label: "Applying database migration" };
		if (/\b(?:mkdir|touch)\b/.test(value)) return { label: "Creating files" };
		if (/\bcp\b/.test(value)) return { label: "Copying files" };
		if (/\bmv\b/.test(value)) return { label: "Moving files" };
		if (/\brm\b/.test(value)) return { label: "Removing files" };
		if (/\b(?:ps|lsof)\b/.test(value))
			return { label: "Inspecting running processes" };
		if (/\b(?:kill|pkill)\b/.test(value)) return { label: "Stopping process" };
		if (/\b(?:curl|wget)\b/.test(value)) return { label: "Fetching data" };
		return {
			label: "Running command",
			detail: commandDetail(command, "command"),
		};
	}
	if (["read", "read_file", "view"].includes(normalized))
		return { label: "Reading files" };
	if (["grep", "glob", "search"].includes(normalized))
		return { label: "Searching code" };
	if (["web_search", "websearch", "webfetch"].includes(normalized))
		return { label: "Researching" };
	if (["patch", "apply_patch", "edit", "write"].includes(normalized))
		return { label: "Updating code" };
	return { label: toolName ? `Using ${toolName}` : "Running tool" };
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
