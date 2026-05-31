import type { ChatMessage } from "../chat/agent-chat-shared.ts";
import type { StoredChatSession } from "../chat/chat-session-store.ts";

export type TaskBoardStatus =
	| "backlog"
	| "planning"
	| "running"
	| "review"
	| "done";

export interface TaskBoardGoalSignal {
	paneId: string;
	agentKind: string;
	cwd: string;
	objective: string;
	isRunning: boolean;
	status: "active" | "paused";
	updatedAt?: number;
	files?: string[];
	checks?: string[];
}

export interface TaskBoardCard {
	id: string;
	source: "goal" | "session" | "promoted";
	status: TaskBoardStatus;
	title: string;
	subtitle: string;
	paneId: string;
	agentKind: string;
	cwd: string | null;
	updatedAt: number;
	messageCount: number;
	session?: StoredChatSession;
	goal?: TaskBoardGoalSignal;
	promotedTask?: PromotedTask;
	signals: string[];
}

export interface PromotedTask {
	id: string;
	paneId: string;
	messageId: string;
	messageRole: string;
	agentKind: string;
	cwd: string | null;
	title: string;
	content: string;
	status: TaskBoardStatus;
	createdAt: number;
	updatedAt: number;
}

export interface TaskBoardInput {
	goals: TaskBoardGoalSignal[];
	sessions: StoredChatSession[];
	messagesByPaneId: Map<string, ChatMessage[]>;
	promotedTasks?: PromotedTask[];
	statusOverrides?: Record<string, TaskBoardStatus>;
}
