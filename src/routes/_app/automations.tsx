import { createFileRoute } from "@octanejs/tanstack-router";
import { AutomationsPage } from "../../modules/automations/components/AutomationsPage.tsx";

export const Route = createFileRoute("/_app/automations")({
	component: AutomationsPage,
});
