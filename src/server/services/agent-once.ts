import type { ChatAgentKind } from "../../features/agents/agents.ts";
import { noop } from "../../lib/data.ts";
import { getAgentAdapter, resolveAgentModel } from "../agents/registry.ts";
import type { AgentRunContext } from "../agents/types.ts";
import { loadDefaultAgentRunSettings } from "./default-chat-settings.ts";

interface RunAgentOnceOptions {
	agentKind?: ChatAgentKind;
	prompt: string;
	cwd: string;
	model?: string;
	reasoningLevel?: string;
	timeoutMs?: number;
}

function extractChatResult(event: unknown): string {
	const value = event as any;
	if (!value?.type) return "";
	if (value.type === "result" && typeof value.result === "string") {
		return value.result;
	}
	if (value.type === "content_block_delta") {
		const delta = value.delta;
		if (delta?.type === "text_delta" && typeof delta.text === "string") {
			return delta.text;
		}
	}
	if (value.type === "content_block_start") {
		const block = value.content_block;
		if (block?.type === "text" && typeof block.text === "string") {
			return block.text;
		}
	}
	return "";
}

export async function runAgentOnce({
	agentKind,
	prompt,
	cwd,
	model,
	reasoningLevel,
	timeoutMs = 30_000,
}: RunAgentOnceOptions): Promise<string | null> {
	const defaults = await loadDefaultAgentRunSettings();
	const effectiveAgentKind = agentKind ?? defaults.agentKind;
	const effectiveModel =
		model ??
		(agentKind && agentKind !== defaults.agentKind
			? undefined
			: defaults.model);
	const effectiveReasoningLevel =
		reasoningLevel ??
		(effectiveAgentKind === "codex" ? defaults.reasoningLevel : undefined);
	const adapter = getAgentAdapter(effectiveAgentKind);
	let sessionId: string | null = null;
	let resultText = "";
	let streamedText = "";

	const ctx: AgentRunContext = {
		paneId: `one-off-${effectiveAgentKind}-${Date.now()}`,
		cwd,
		model: resolveAgentModel(effectiveAgentKind, effectiveModel),
		reasoningLevel: effectiveReasoningLevel,
		getSessionId: () => sessionId,
		isCancelled: () => false,
		updateSessionId: (nextSessionId) => {
			sessionId = nextSessionId;
		},
		emitChatEvent: (event) => {
			const text = extractChatResult(event);
			if (!text) return;
			const value = event as any;
			if (value?.type === "result") resultText = text;
			else streamedText += text;
		},
		emitAgentEvent: (event) => {
			if (event.type === "result") resultText = event.text;
			if (event.type === "text-delta") streamedText += event.text;
		},
		emitStatus: noop,
		emitActivity: noop,
		emitSystemMessage: noop,
	};

	const state = adapter.createState(ctx);
	const handle = adapter.createHandle(prompt, ctx, state);
	let timeout: ReturnType<typeof setTimeout> | null = null;

	try {
		const output = await Promise.race([
			handle.run(),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => {
					handle.kill();
					reject(new Error(`${adapter.displayName} one-off call timed out`));
				}, timeoutMs);
			}),
		]);
		const lastAssistantMessage =
			output && typeof output === "object"
				? output.lastAssistantMessage
				: undefined;
		const text = (lastAssistantMessage || resultText || streamedText).trim();
		return text || null;
	} catch {
		return null;
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}
