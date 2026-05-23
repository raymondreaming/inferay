import { loadAppInfo } from "../services/app-info.ts";

export function appInfoRoutes() {
	return {
		"/api/app-info": {
			GET: async () => Response.json(await loadAppInfo()),
		},
	};
}
