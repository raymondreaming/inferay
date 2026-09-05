import type { QueryClient } from "@octanejs/tanstack-query";

import { createRootRouteWithContext } from "@octanejs/tanstack-router";

import "../design-system/styles.css";
import "virtual:stylex.css";
import { DocumentShell } from "../app/components/DocumentShell/index.tsx";
import { RootComponent } from "../app/components/RootComponent/index.tsx";

export interface RouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1.0, viewport-fit=cover",
			},
			{ title: "inferay" },
			{ name: "theme-color", content: "#09090b" },
			{ name: "color-scheme", content: "dark" },
			{
				name: "description",
				content: "inferay — run Claude and Codex side by side",
			},
		],
		links: [
			{ rel: "preconnect", href: "https://fonts.googleapis.com" },
			{
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossOrigin: "anonymous",
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Manrope:wght@400;500;600&display=swap",
			},
		],
	}),
	shellComponent: DocumentShell,
	component: RootComponent,
});
export { RootComponent } from "../app/components/RootComponent/index.tsx";
