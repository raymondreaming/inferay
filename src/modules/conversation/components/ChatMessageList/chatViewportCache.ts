export type ChatScrollSnapshot = {
	atBottom: boolean;
	fromBottom: number;
	top: number;
};
export type ChatViewportState = {
	snapshot: ChatScrollSnapshot;
	heights: Map<string, number>;
	width: number | null;
};

// Keep cheap viewport state beyond a visible workspace's component lifetime.
// No DOM nodes or observers are retained, and only recent panes occupy the cache.
export function createChatViewportCache(maxEntries = 16) {
	const entries = new Map<string, ChatViewportState>();
	return (paneId: string) => {
		const state = entries.get(paneId) ?? {
			snapshot: { atBottom: true, fromBottom: 0, top: 0 },
			heights: new Map<string, number>(),
			width: null,
		};
		entries.delete(paneId);
		entries.set(paneId, state);
		while (entries.size > maxEntries)
			entries.delete(entries.keys().next().value!);
		return state;
	};
}
export const chatViewportState = createChatViewportCache();
