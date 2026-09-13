import { createRouter } from "@solidjs/router";
import { lazy } from "solid-js";
import { AppLayout } from "./app/components/AppLayout/index.tsx";

const AgentPage = lazy(() =>
	import("./modules/workspace/components/AgentPage/index.tsx").then(
		(module) => ({ default: module.AgentPage }),
	),
);

export const Router = createRouter({
	routes: [
		{
			path: "/",
			component: () => (
				<AppLayout>
					<AgentPage />
				</AppLayout>
			),
		},
	],
	singleFlight: false,
});
