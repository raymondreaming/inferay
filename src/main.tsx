import * as stylex from "@stylexjs/stylex";
import { lazy, type ReactElement, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Sidebar } from "./components/layout/Sidebar.tsx";
import { ErrorBoundary } from "./components/ui/ErrorBoundary.tsx";
import { preloadPrompts } from "./features/prompts/usePrompts.ts";
import {
	APP_PAGE_ROUTES,
	type AppRouteId,
	DEFAULT_APP_ROUTE,
} from "./lib/app-navigation.tsx";
import { applyAppTheme, loadAppThemeId } from "./lib/app-theme.ts";
import {
	CLIENT_STORAGE_CHANGED_EVENT,
	hydrateStoredValues,
} from "./lib/client-storage-sync.ts";
import { getServerOrigin, resolveServerUrl } from "./lib/server-origin.ts";
import { readStoredBoolean } from "./lib/stored-json.ts";
import { AutomationsPage } from "./pages/AutomationsPage";
import { GoalsPage } from "./pages/GoalsPage";
import { ImagesPage } from "./pages/ImagesPage";
import { ONBOARDING_DONE_KEY, OnboardingPage } from "./pages/OnboardingPage";
import { ProfilePage } from "./pages/ProfilePage";
import { PromptsPage } from "./pages/PromptsPage";
import { SessionsPage } from "./pages/SessionsPage";
import {
	colorTheme,
	controlSizeTheme,
	effectTheme,
	fontTheme,
	motionTheme,
	radiusTheme,
	shadowTheme,
} from "./tokens.stylex.ts";

const TerminalPage = lazy(() =>
	import("./pages/Terminal").then((m) => ({ default: m.TerminalPage }))
);

if (window.location.origin !== getServerOrigin()) {
	const originalFetch = window.fetch.bind(window);
	const routedFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		if (typeof input === "string" && input.startsWith("/")) {
			return originalFetch(resolveServerUrl(input), init);
		}
		if (input instanceof URL && input.pathname.startsWith("/")) {
			return originalFetch(
				resolveServerUrl(`${input.pathname}${input.search}`),
				init
			);
		}
		if (input instanceof Request) {
			const url = new URL(input.url, window.location.origin);
			if (url.pathname.startsWith("/")) {
				return originalFetch(
					new Request(resolveServerUrl(`${url.pathname}${url.search}`), input),
					init
				);
			}
		}
		return originalFetch(input, init);
	}) as typeof window.fetch;
	Object.assign(routedFetch, window.fetch);
	window.fetch = routedFetch;
}

await hydrateStoredValues();

const onboardingDone = readStoredBoolean(ONBOARDING_DONE_KEY);
const defaultRoute = onboardingDone ? DEFAULT_APP_ROUTE : "/onboarding";

applyAppTheme(loadAppThemeId());
window.addEventListener(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
	const key = (event as CustomEvent<{ key?: string }>).detail?.key;
	if (key === "inferay-app-theme-id" || key === "inferay-app-custom-theme") {
		applyAppTheme(loadAppThemeId());
	}
});

if (typeof window !== "undefined") {
	const idle =
		window.requestIdleCallback ??
		((cb: IdleRequestCallback) => window.setTimeout(cb, 150));
	idle(() => {
		void preloadPrompts();
	});
}

const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("Missing root element.");
}

const root = createRoot(rootElement);
function AppShell() {
	const routeElements = {
		terminal: <TerminalPage />,
		sessions: <SessionsPage />,
		prompts: <PromptsPage />,
		goals: <GoalsPage />,
		automations: <AutomationsPage />,
		images: <ImagesPage />,
		profile: <ProfilePage />,
	} satisfies Record<AppRouteId, ReactElement>;

	const themeProps = stylex.props(
		colorTheme,
		controlSizeTheme,
		fontTheme,
		radiusTheme,
		motionTheme,
		shadowTheme,
		effectTheme
	);

	return (
		<div
			{...themeProps}
			className={`flex h-screen bg-inferay-black ${themeProps.className ?? ""}`}
		>
			<Sidebar />
			<main className="min-w-0 flex-1 overflow-hidden">
				<Suspense fallback={null}>
					<Routes>
						{APP_PAGE_ROUTES.map((route) => (
							<Route
								key={route.id}
								path={route.path}
								element={routeElements[route.id]}
							/>
						))}
						<Route
							path="*"
							element={<Navigate to={DEFAULT_APP_ROUTE} replace />}
						/>
					</Routes>
				</Suspense>
			</main>
		</div>
	);
}

function OnboardingShell() {
	const themeProps = stylex.props(
		colorTheme,
		controlSizeTheme,
		fontTheme,
		radiusTheme,
		motionTheme,
		shadowTheme,
		effectTheme
	);

	return (
		<div
			{...themeProps}
			className={`flex h-screen flex-col bg-inferay-black ${themeProps.className ?? ""}`}
		>
			<div className="inferay-window-spacer electrobun-webkit-app-region-drag h-6 shrink-0 bg-inferay-black" />
			<div className="min-h-0 flex-1">
				<OnboardingPage />
			</div>
		</div>
	);
}

root.render(
	<ErrorBoundary>
		<HashRouter>
			<Routes>
				<Route path="/" element={<Navigate to={defaultRoute} replace />} />
				<Route path="/onboarding" element={<OnboardingShell />} />
				<Route path="/*" element={<AppShell />} />
			</Routes>
		</HashRouter>
	</ErrorBoundary>
);
