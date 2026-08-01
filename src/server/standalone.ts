import { shutdownAppServices, startAppServer } from "./app-server.ts";
import { PidTracker } from "./services/pid-tracker.ts";

await startAppServer(Number(process.env.AGENT_GUI_SERVER_PORT || "4001"));
await PidTracker.cleanupOrphans();

process.on("SIGTERM", shutdownAppServices);
process.on("SIGINT", shutdownAppServices);
