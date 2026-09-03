import { createRouter } from "@octanejs/tanstack-router";
import { routeTree } from "./routeTree.gen.ts";
import { queryClient } from "./shared/lib/query-client.ts";

export function getRouter() {
	return createRouter({
		routeTree,
		context: { queryClient },
		defaultPreload: "intent",
		defaultPreloadStaleTime: 15_000,
		scrollRestoration: true,
	});
}

declare module "@octanejs/tanstack-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
