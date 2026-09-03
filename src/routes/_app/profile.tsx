import { createFileRoute } from "@octanejs/tanstack-router";
import { ProfilePage } from "../../modules/profile/components/ProfilePage.tsx";

export const Route = createFileRoute("/_app/profile")({
	component: ProfilePage,
});
