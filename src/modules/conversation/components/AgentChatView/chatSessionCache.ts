import type { CheckpointMeta } from "@contracts";
import { type ChatReplica, ChatSessionRetention } from "@shared/lib/native.tsx";
import type { ChatLoadingState, ChatMessage } from "./types.ts";

export type RetainedChatSession = {
	paneId: string;
	replica: ChatReplica;
	messages: ChatMessage[];
	nativeTranscript: ChatMessage[] | null;
	checkpoints: CheckpointMeta[];
	runStatus: ChatLoadingState;
	expandedTools: Set<string>;
};

/** Only inactive sessions live here. Taking an entry transfers replica ownership. */
const retention = new ChatSessionRetention(16, 64 * 1024 * 1024);
const entries = new Map<string, RetainedChatSession>();

export const chatSessionCache = {
	take(identity: string) {
		const session = entries.get(identity);
		if (!session) return;
		retention.take(identity);
		entries.delete(identity);
		return session;
	},
	retain(identity: string, session: RetainedChatSession) {
		const previous = entries.get(identity);
		entries.delete(identity);
		if (previous && previous.replica !== session.replica)
			previous.replica.free();
		const size =
			session.messages.reduce(
				(sum, message) => sum + message.content.length * 4 + 1024,
				0,
			) +
			session.checkpoints.length * 1024;
		const [retained, evicted] = JSON.parse(
			retention.retain(identity, session.paneId, size),
		) as [boolean, string[]];
		if (retained) entries.set(identity, session);
		else session.replica.free();
		for (const identity of evicted) {
			const discarded = entries.get(identity);
			entries.delete(identity);
			discarded?.replica.free();
		}
	},
	setPaneIds(ids: Iterable<string>) {
		const evicted = JSON.parse(
			retention.set_pane_ids(JSON.stringify([...ids])),
		) as string[];
		for (const identity of evicted) {
			const discarded = entries.get(identity);
			entries.delete(identity);
			discarded?.replica.free();
		}
	},
};
