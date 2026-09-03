import { createFileRoute } from "@octanejs/tanstack-router";
import { PromptsPage } from "../../modules/skills/components/PromptsPage.tsx";

export const Route = createFileRoute("/_app/skills")({
	component: PromptsPage,
});
