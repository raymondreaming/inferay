import type { QueryClient } from "@octanejs/tanstack-query";
import { QueryClientProvider } from "@octanejs/tanstack-query";
import {
	Body,
	createRootRouteWithContext,
	Head,
	HeadContent,
	Html,
	Outlet,
	Scripts,
} from "@octanejs/tanstack-router";
import { ErrorBoundary } from "../components/ui/ErrorBoundary.tsx";
import { queryClient } from "../lib/query-client.ts";
import "../index.css";
import "virtual:stylex.css";

interface RouterContext {
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
				href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap",
			},
		],
	}),
	shellComponent: DocumentShell,
	component: RootComponent,
});

function DocumentShell({ children }: { readonly children?: unknown }) {
	return (
		<Html lang="en">
			<Head>
				<HeadContent />
			</Head>
			<Body>
				{children}
				<Scripts />
			</Body>
		</Html>
	);
}

function RootComponent() {
	return (
		<QueryClientProvider client={queryClient}>
			<ErrorBoundary>
				<Outlet />
			</ErrorBoundary>
		</QueryClientProvider>
	);
}
