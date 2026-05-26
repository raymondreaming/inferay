import type { ChatAgentKind } from "../../features/agents/agents.ts";
import type { AgentEvent } from "./events.ts";

export interface AgentActivityEvent {
	toolName: string;
	summary: string;
	isStreaming?: boolean;
}

export interface AgentRunContext {
	readonly paneId: string;
	readonly cwd: string;
	readonly referencePaths?: readonly string[];
	readonly model?: string;
	readonly reasoningLevel?: string;
	getSessionId(): string | null;
	isCancelled(): boolean;
	updateSessionId(nextSessionId: string): void;
	emitChatEvent(event: unknown): void;
	emitAgentEvent(event: AgentEvent): void;
	emitStatus(status: string, isLoading?: boolean): void;
	emitActivity(activity: AgentActivityEvent): void;
	emitSystemMessage(message: string): void;
}

export interface AgentHandle {
	run(): Promise<AgentRunResult | undefined>;
	stop(): void;
	kill(): void;
}

export interface AgentRunResult {
	lastAssistantMessage?: string;
}

export interface AgentAdapter<State = unknown> {
	readonly kind: ChatAgentKind;
	readonly displayName: string;
	createState(ctx: AgentRunContext): State;
	createHandle(prompt: string, ctx: AgentRunContext, state: State): AgentHandle;
}
