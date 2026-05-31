import { tryRoute } from "../../lib/route-helpers.ts";
import { ChatService } from "../services/agent-chat.ts";

export function goalRoutes() {
	return {
		"/api/goals": {
			GET: tryRoute(async () => {
				return Response.json({ goals: ChatService.listGoals() });
			}),
		},
		"/api/goals/clear": {
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as { paneId?: string };
				if (typeof body.paneId !== "string" || !body.paneId.trim()) {
					return Response.json({ error: "Missing paneId" }, { status: 400 });
				}
				return Response.json({ ok: ChatService.clearGoal(body.paneId) });
			}),
		},
	};
}
