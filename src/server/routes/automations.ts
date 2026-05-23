import { tryRoute } from "../../lib/route-helpers.ts";
import {
	type AutomationRunRequest,
	type AutomationStore,
	loadAutomations,
	runAutomationOnce,
	saveAutomations,
} from "../services/automations.ts";

export function automationRoutes() {
	return {
		"/api/automations": {
			GET: tryRoute(async () => {
				return Response.json(await loadAutomations());
			}),
			PUT: tryRoute(async (req) => {
				const body = (await req.json()) as Partial<AutomationStore>;
				return Response.json(await saveAutomations(body));
			}),
		},
		"/api/automations/run": {
			POST: tryRoute(async (req) => {
				const result = await runAutomationOnce(
					(await req.json()) as AutomationRunRequest
				);
				return result.ok
					? Response.json({ result: result.result })
					: Response.json({ error: result.error }, { status: result.status });
			}),
		},
	};
}
