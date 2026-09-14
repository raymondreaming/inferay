import type { ChatScrollSnapshot } from "@contracts";
import { ChatViewportRetention } from "@shared/lib/native.tsx";
export type ChatViewportState = {
	snapshot: ChatScrollSnapshot;
	heights: Map<string, number>;
	width: number | null;
};

// Keep cheap viewport state beyond a visible workspace's component lifetime.
// No DOM nodes or observers are retained, and only recent panes occupy the cache.
const retention = new ChatViewportRetention(16);
const entries = new Map<string, ChatViewportState>();

export const chatViewportState = (paneId: string) => {
	const state = entries.get(paneId) ?? {
		snapshot: { atBottom: true, fromBottom: 0, top: 0 },
		heights: new Map<string, number>(),
		width: null,
	};
	entries.set(paneId, state);
	for (const evicted of JSON.parse(retention.touch(paneId)) as string[])
		entries.delete(evicted);
	return state;
};
