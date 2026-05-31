import { basename } from "../../lib/format.ts";
import type { DocumentArtifact } from "../artifacts/types.ts";
import type {
	ChatMessage,
	CheckpointInfo,
	ComposerContextBlock,
} from "./agent-chat-shared.ts";
import type {
	StoredChatSession,
	StoredLoadingState,
} from "./chat-session-store.ts";

export type SessionLifecycleStatus = "running" | "review" | "ready" | "empty";

export interface SessionArtifactSummary {
	id: string;
	title: string;
	subtitle: string;
	updatedAt: number;
}

export interface SessionDetailModel {
	title: string;
	workspaceLabel: string;
	status: SessionLifecycleStatus;
	statusLabel: string;
	messageCount: number;
	checkpointCount: number;
	changedFiles: string[];
	commands: string[];
	artifacts: SessionArtifactSummary[];
	recentMessages: ChatMessage[];
	transcriptArtifact: {
		title: string;
		subtitle: string;
		content: string;
	};
}

function compact(value: string, max = 180): string {
	const text = value.replace(/\s+/g, " ").trim();
	return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function commandSignals(messages: readonly ChatMessage[]): string[] {
	const commands = new Set<string>();
	for (const message of messages) {
		if (message.toolName) commands.add(message.toolName);
		const running = message.content.match(/^Running \/(.+)\.\.\.$/);
		if (running?.[1]) commands.add(`/${running[1]}`);
	}
	return [...commands].slice(0, 12);
}

function checkpointFiles(checkpoints: readonly CheckpointInfo[]): string[] {
	const files = new Set<string>();
	for (const checkpoint of checkpoints) {
		for (const file of checkpoint.changedFiles) files.add(file.path);
	}
	return [...files].slice(0, 24);
}

function sessionArtifacts(
	session: StoredChatSession,
	artifacts: readonly DocumentArtifact[]
): SessionArtifactSummary[] {
	return [...artifacts]
		.filter((artifact) => artifact.sourcePaneId === session.paneId)
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.slice(0, 12)
		.map((artifact) => ({
			id: artifact.id,
			title: artifact.title,
			subtitle: artifact.subtitle,
			updatedAt: artifact.updatedAt,
		}));
}

function getSessionLifecycleStatus({
	messages,
	checkpoints,
	loadingState,
}: {
	messages: readonly ChatMessage[];
	checkpoints: readonly CheckpointInfo[];
	loadingState?: StoredLoadingState | null;
}): { status: SessionLifecycleStatus; label: string } {
	if (loadingState?.isLoading) {
		return { status: "running", label: loadingState.status || "Running" };
	}
	if (checkpointFiles(checkpoints).length > 0) {
		return { status: "review", label: "Needs review" };
	}
	if (messages.length > 0) return { status: "ready", label: "Ready" };
	return { status: "empty", label: "Empty" };
}

export function buildSessionDetailModel(
	session: StoredChatSession,
	messages: readonly ChatMessage[],
	checkpoints: readonly CheckpointInfo[] = [],
	loadingState?: StoredLoadingState | null,
	artifacts: readonly DocumentArtifact[] = []
): SessionDetailModel {
	const title =
		session.summary ||
		session.lastMessage ||
		(session.cwd ? basename(session.cwd) : "Untitled session");
	const workspaceLabel = session.cwd ? basename(session.cwd) : "No folder";
	const changedFiles = checkpointFiles(checkpoints);
	const lifecycle = getSessionLifecycleStatus({
		messages,
		checkpoints,
		loadingState,
	});
	const transcriptLines = messages.map((message) =>
		[
			`## ${message.role}${message.intent ? ` · ${message.intent}` : ""}`,
			message.content.trim(),
		].join("\n\n")
	);
	return {
		title,
		workspaceLabel,
		status: lifecycle.status,
		statusLabel: lifecycle.label,
		messageCount: messages.length || session.messageCount,
		checkpointCount: checkpoints.length,
		changedFiles,
		commands: commandSignals(messages),
		artifacts: sessionArtifacts(session, artifacts),
		recentMessages: [...messages].slice(-8).reverse(),
		transcriptArtifact: {
			title: `Session Transcript - ${title}`,
			subtitle: `${workspaceLabel} · ${messages.length || session.messageCount} messages`,
			content: [
				`# ${title}`,
				"",
				`workspace=${session.cwd ?? "none"}`,
				`agent=${session.agentKind}`,
				session.model ? `model=${session.model}` : null,
				session.reasoningLevel ? `reasoning=${session.reasoningLevel}` : null,
				"",
				checkpoints.length > 0
					? `checkpoints=${checkpoints.length}`
					: "checkpoints=0",
				"",
				...transcriptLines.map(compact),
			]
				.filter((line): line is string => line !== null)
				.join("\n"),
		},
	};
}

export function sessionContextBlock(
	detail: SessionDetailModel
): Omit<ComposerContextBlock, "id" | "createdAt"> {
	return {
		source: "artifact",
		title: `Session: ${detail.title}`,
		subtitle: `${detail.workspaceLabel} · ${detail.messageCount} messages · ${detail.checkpointCount} checkpoints`,
		content: detail.transcriptArtifact.content,
	};
}
