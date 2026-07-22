import * as stylex from "@stylexjs/stylex";
import { lazy, type ReactElement, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Sidebar } from "./components/layout/Sidebar.tsx";
import { QuickFileOverlay } from "./components/file/QuickFileOverlay.tsx";
import { TerminalShellHeader } from "./components/layout/TerminalShellHeader.tsx";
import { ErrorBoundary } from "./components/ui/ErrorBoundary.tsx";
import { preloadPrompts } from "./features/prompts/usePrompts.ts";
import {
	APP_PAGE_ROUTES,
	type AppRouteId,
	DEFAULT_APP_ROUTE,
	DEFAULT_TERMINAL_MAIN_VIEW,
} from "./lib/app-navigation.tsx";
import {
	APP_REGION_DRAG_CLASS,
	applyAppTheme,
	loadAppThemeId,
} from "./lib/app-theme.ts";
import { TERMINAL_MAIN_VIEW_STORAGE_KEY } from "./lib/client-storage-keys.ts";
import { hydrateStoredValues } from "./lib/client-storage-sync.ts";
import { getServerOrigin, resolveServerUrl } from "./lib/fetch-json.ts";
import { readStoredBoolean, writeStoredValue } from "./lib/stored-json.ts";
import { AutomationsPage } from "./pages/AutomationsPage";
import { ImagesPage } from "./pages/ImagesPage";
import { ONBOARDING_DONE_KEY, OnboardingPage } from "./pages/OnboardingPage";
import { ProfilePage } from "./pages/ProfilePage";
import { PromptsPage } from "./pages/PromptsPage";
import { SessionsPage } from "./pages/SessionsPage";
import { SimulatorsPage } from "./pages/SimulatorsPage";
import {
	color,
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
	window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
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
}

await hydrateStoredValues();
// Main view is a launch target, not a durable workspace choice.
writeStoredValue(TERMINAL_MAIN_VIEW_STORAGE_KEY, DEFAULT_TERMINAL_MAIN_VIEW);

const onboardingDone = readStoredBoolean(ONBOARDING_DONE_KEY);
const defaultRoute = onboardingDone ? DEFAULT_APP_ROUTE : "/onboarding";

applyAppTheme(loadAppThemeId());

if (typeof window !== "undefined") {
	const idle =
		window.requestIdleCallback ??
		((cb: IdleRequestCallback) => window.setTimeout(cb, 150));
	idle(() => {
		void preloadPrompts();
	});
}

const styles = stylex.create({
	shell: {
		backgroundColor: color.background,
		display: "flex",
		flexDirection: "column",
		height: "100vh",
	},
	windowSpacer: {
		backgroundColor: color.background,
		flexShrink: 0,
		height: "1.5rem",
	},
	appBody: {
		display: "flex",
		flex: 1,
		minHeight: 0,
	},
	mainColumn: {
		backgroundColor: color.background,
		borderColor: "rgba(255,255,255,0.16)",
		borderRadius: 14,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow:
			"inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 24px rgba(0,0,0,0.18), 0 24px 60px rgba(0,0,0,0.42)",
		display: "flex",
		flex: 1,
		flexDirection: "column",
		marginTop: 36,
		marginRight: 10,
		marginBottom: 10,
		minWidth: 0,
		overflow: "hidden",
	},
	mainContent: {
		flex: 1,
		minWidth: 0,
		overflow: "hidden",
	},
	onboardingBody: {
		flex: 1,
		minHeight: 0,
	},
});

const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("Missing root element.");
}

const root = createRoot(rootElement);
const shellThemeProps = stylex.props(
	colorTheme,
	controlSizeTheme,
	fontTheme,
	radiusTheme,
	motionTheme,
	shadowTheme,
	effectTheme,
	styles.shell
);
const routeElements = {
	terminal: <TerminalPage />,
	prompts: <PromptsPage />,
	sessions: <SessionsPage />,
	automations: <AutomationsPage />,
	images: <ImagesPage />,
	simulators: <SimulatorsPage />,
	profile: <ProfilePage />,
} satisfies Record<AppRouteId, ReactElement>;
const fallbackRouteElement = <Navigate to={DEFAULT_APP_ROUTE} replace />;

function AppShell() {
	return (
		<div {...shellThemeProps}>
			<TerminalShellHeader />
			<div {...stylex.props(styles.appBody)}>
				<Sidebar />
				<div {...stylex.props(styles.mainColumn)}>
					<main {...stylex.props(styles.mainContent)}>
						<Suspense fallback={null}>
							<Routes>
								{APP_PAGE_ROUTES.map((route) => (
									<Route
										key={route.id}
										path={route.path}
										element={routeElements[route.id]}
									/>
								))}
								<Route path="*" element={fallbackRouteElement} />
							</Routes>
						</Suspense>
					</main>
				</div>
			</div>
			<QuickFileOverlay />
		</div>
	);
}

function OnboardingShell() {
	return (
		<div {...shellThemeProps}>
			<div
				{...stylex.props(styles.windowSpacer)}
				className={`inferay-window-spacer ${APP_REGION_DRAG_CLASS} ${stylex.props(styles.windowSpacer).className ?? ""}`}
			/>
			<div {...stylex.props(styles.onboardingBody)}>
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
