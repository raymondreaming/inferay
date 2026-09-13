import type { CheckpointMeta } from "@contracts";
import type { ChatReplica } from "@shared/lib/native.tsx";
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
export function createChatSessionCache(
	maxEntries = 16,
	maxWeight = 64 * 1024 * 1024,
) {
	const entries = new Map<
		string,
		{ session: RetainedChatSession; weight: number }
	>();
	let weight = 0;
	let paneIds: Set<string> | null = null;
	const take = (identity: string) => {
		const entry = entries.get(identity);
		if (!entry) return;
		entries.delete(identity);
		weight -= entry.weight;
		return entry.session;
	};
	const retain = (identity: string, session: RetainedChatSession) => {
		const previous = take(identity);
		if (previous && previous.replica !== session.replica)
			previous.replica.free();
		if (paneIds && !paneIds.has(session.paneId)) {
			session.replica.free();
			return;
		}
		// Account for JS/WASM text copies and per-message metadata without
		// serializing the transcript during a tab click. This is a cache weight,
		// not an estimate of the WebView's total heap or decoded image memory.
		const size =
			session.messages.reduce(
				(sum, message) => sum + message.content.length * 4 + 1024,
				0,
			) +
			session.checkpoints.length * 1024;
		entries.set(identity, { session, weight: size });
		weight += size;
		while (entries.size > maxEntries || weight > maxWeight) {
			const oldest = entries.keys().next().value!;
			take(oldest)!.replica.free();
		}
	};
	const setPaneIds = (ids: Iterable<string>) => {
		paneIds = new Set(ids);
		for (const [identity, entry] of entries) {
			if (!paneIds.has(entry.session.paneId)) take(identity)!.replica.free();
		}
	};
	return { take, retain, setPaneIds };
}

export const chatSessionCache = createChatSessionCache();
