import { agentAccountRoutes } from "./agent-accounts.ts";
import { appInfoRoutes } from "./app-info.ts";
import { checkpointRoutes } from "./checkpoint.ts";
import { clientStorageRoutes } from "./client-storage.ts";
import { configRoutes } from "./config.ts";
import { featureRoutes } from "./feature-routes.ts";
import { fileRoutes } from "./files.ts";
import { forgeRoutes } from "./forge.ts";
import { gitRoutes } from "./git.ts";
import { nativeRoutes } from "./native.ts";
import { promptRoutes } from "./prompts.ts";
import { simulatorRoutes } from "./simulator.ts";
import { terminalRoutes } from "./terminal.ts";
import { titleRoutes } from "./title.ts";
export function buildApiRoutes() {
	return {
		...agentAccountRoutes(),
		...appInfoRoutes(),
		...configRoutes(),
		...fileRoutes(),
		...forgeRoutes(),
		...nativeRoutes(),
		...terminalRoutes(),
		...clientStorageRoutes(),
		...checkpointRoutes(),
		...promptRoutes(),
		...gitRoutes(),
		...simulatorRoutes(),
		...titleRoutes(),
		...featureRoutes(),
	};
}
