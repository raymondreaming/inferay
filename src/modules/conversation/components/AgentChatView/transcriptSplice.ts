import type {
	ChatTranscriptMessage,
	ChatTranscriptUpdate,
	TranscriptAdmission,
} from "@contracts";
import type { ChatMessage } from "./types.ts";

export type TranscriptEnvelope = {
	messages?: ChatTranscriptMessage[];
	transcriptUpdate?: ChatTranscriptUpdate;
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
			? { ...change.message, content: change.message.content! }
			: {
					...change.message,
					content:
						before[admission.start + index].content + change.appendContent,
				},
	);
}
