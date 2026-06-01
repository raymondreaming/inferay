import { rm } from "node:fs/promises";
import { join } from "node:path";
import { readJson, writeJson } from "../../lib/route-helpers.ts";
import { userDataPath } from "../../lib/user-data.ts";

const CHAT_QUEUE_DIR = userDataPath("chat-queues");

interface ChatQueueFile {
	queue: unknown[];
	updatedAt: number;
}

function safePaneId(paneId: string): string {
	if (/^[a-zA-Z0-9._:-]+$/.test(paneId)) return paneId;
	throw new Error("Invalid pane id");
}

export function createChatQueueStore(root = CHAT_QUEUE_DIR) {
	const queuePath = (paneId: string) =>
		join(root, `${safePaneId(paneId)}.json`);

	return {
		async loadChatQueue(paneId: string): Promise<unknown[]> {
			const stored = await readJson<ChatQueueFile>(queuePath(paneId), {
				queue: [],
				updatedAt: 0,
			});
			return Array.isArray(stored.queue) ? stored.queue : [];
		},
		async saveChatQueue(paneId: string, queue: unknown[]): Promise<void> {
			await writeJson(queuePath(paneId), {
				queue,
				updatedAt: Date.now(),
			});
		},
		async deleteChatQueue(paneId: string): Promise<void> {
			await rm(queuePath(paneId), { force: true });
		},
	};
}

const chatQueueStore = createChatQueueStore();

export async function loadChatQueue(paneId: string): Promise<unknown[]> {
	return chatQueueStore.loadChatQueue(paneId);
}

export async function saveChatQueue(
	paneId: string,
	queue: unknown[]
): Promise<void> {
	await chatQueueStore.saveChatQueue(paneId, queue);
}

export async function deleteChatQueue(paneId: string): Promise<void> {
	await chatQueueStore.deleteChatQueue(paneId);
}
