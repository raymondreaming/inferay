import { createFileRoute } from "@octanejs/tanstack-router";
import { AgentPage } from "../../modules/workspace/components/AgentPage/index.tsx";

export const Route = createFileRoute("/_app/agent")({
	component: AgentPage,
});
