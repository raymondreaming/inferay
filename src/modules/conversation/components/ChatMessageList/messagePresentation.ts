import { project as rustProject } from "@shared/lib/native.tsx";
import type { ChatMessage } from "../AgentChatView/useChatConnection.tsx";

/** Projects a user chat message into text and image content for rendering. */
export function getUserMessagePresentation(
	message: ChatMessage,
	slashCommandNames: readonly string[],
): {
	content: string;
	imagePaths: string[];
} | null {
	return rustProject("userMessage", {
		message,
		commands: slashCommandNames,
	});
}
