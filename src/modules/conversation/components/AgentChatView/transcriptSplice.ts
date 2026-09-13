import type { ChatMessage } from "./useChatConnection.tsx";

export type TranscriptAdmission =
	| { kind: "none" | "ignore" | "resync"; reconnect?: boolean }
	| { kind: "sync" | "patch"; start: number; deleteCount: number };

type TranscriptEnvelope = {
	messages?: ChatMessage[];
	transcriptUpdate?: {
		messages: Array<{
			message: ChatMessage;
			appendContent?: string;
		}>;
	};
};

/** Only call after this exact event has been admitted by ChatReplica. */
export function admittedTranscriptMessages(
	admission: Extract<TranscriptAdmission, { kind: "sync" | "patch" }>,
	before: ChatMessage[],
	event: TranscriptEnvelope,
): ChatMessage[] {
	if (admission.kind === "sync") return event.messages!;
	return event.transcriptUpdate!.messages.map((change, index) =>
		change.appendContent === undefined
			? change.message
			: {
					...change.message,
					content:
						before[admission.start + index].content + change.appendContent,
				},
	);
}
