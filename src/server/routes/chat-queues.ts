import { badRequest, tryRoute } from "../../lib/route-helpers.ts";
import {
	deleteChatQueue,
	loadChatQueue,
	saveChatQueue,
} from "../services/chat-queues.ts";

export function chatQueueRoutes() {
	return {
		"/api/chat-queues/:paneId": {
			GET: tryRoute(async (req: Request & { params: { paneId: string } }) => {
				return Response.json({ queue: await loadChatQueue(req.params.paneId) });
			}),
			PUT: tryRoute(async (req: Request & { params: { paneId: string } }) => {
				const body = await req.json();
				if (!Array.isArray(body?.queue)) {
					return badRequest("Expected queue array");
				}
				await saveChatQueue(req.params.paneId, body.queue);
				return Response.json({ ok: true });
			}),
			DELETE: tryRoute(
				async (req: Request & { params: { paneId: string } }) => {
					await deleteChatQueue(req.params.paneId);
					return Response.json({ ok: true });
				}
			),
		},
	};
}
