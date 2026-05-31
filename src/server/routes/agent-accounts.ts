import { loadAgentAccountStatus } from "../services/agent-account-status.ts";

export function agentAccountRoutes() {
	return {
		"/api/agents/account-status": {
			GET: async () => Response.json(await loadAgentAccountStatus()),
		},
	};
}
