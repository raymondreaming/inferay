import { badRequest, tryRoute } from "../../lib/route-helpers.ts";
import {
	deleteChatTranscript,
	loadChatTranscript,
	saveChatTranscript,
} from "../services/chat-transcripts.ts";

export function chatTranscriptRoutes() {
	return {
		"/api/chat-transcripts/:paneId": {
			GET: tryRoute(async (req: Request & { params: { paneId: string } }) => {
				const messages = await loadChatTranscript(req.params.paneId);
				return Response.json({ messages });
			}),
			PUT: tryRoute(async (req: Request & { params: { paneId: string } }) => {
				const body = await req.json();
				if (!Array.isArray(body?.messages)) {
					return badRequest("Expected messages array");
				}
				await saveChatTranscript(req.params.paneId, body.messages);
				return Response.json({ ok: true });
			}),
			DELETE: tryRoute(
				async (req: Request & { params: { paneId: string } }) => {
					await deleteChatTranscript(req.params.paneId);
					return Response.json({ ok: true });
				}
			),
		},
	};
}
