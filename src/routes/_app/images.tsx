import { createFileRoute } from "@octanejs/tanstack-router";
import { ImagesPage } from "../../modules/images/components/ImagesPage/index.tsx";

export const Route = createFileRoute("/_app/images")({
	component: ImagesPage,
});
