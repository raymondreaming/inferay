import * as stylex from "@octanejs/stylex";
import "./index.css";
import "virtual:stylex.css";
import { createRoot, lazy, Suspense, useEffect, useState } from "octane";
import type { CSSProperties } from "react";
import { AgentShellHeader } from "./components/layout/AgentShellHeader.tsx";
import { Sidebar } from "./components/layout/Sidebar.tsx";
import { ErrorBoundary } from "./components/ui/ErrorBoundary.tsx";
import { preloadPrompts } from "./features/prompts/usePrompts.tsx";
import {
	applyAppBackgroundPalette,
	deriveAppBackgroundPalette,
	getBuiltInBackgroundPath,
	loadAppBackgroundSettings,
	restoreAppTheme,
} from "./lib/app-background.ts";
import {
	APP_PAGE_ROUTES,
	type AppRouteId,
	DEFAULT_AGENT_MAIN_VIEW,
	DEFAULT_APP_ROUTE,
} from "./lib/app-navigation.tsx";
import {
	APP_REGION_DRAG_CLASS,
	applyAppTheme,
	loadAppThemeId,
} from "./lib/app-theme.ts";
import {
	AGENT_MAIN_VIEW_STORAGE_KEY,
	APP_BACKGROUND_STORAGE_KEY,
	APP_THEME_STORAGE_KEY,
	ONBOARDING_DONE_STORAGE_KEY,
} from "./lib/client-storage-keys.ts";
import {
	CLIENT_STORAGE_CHANGED_EVENT,
	hydrateStoredValues,
} from "./lib/client-storage-sync.ts";
import { getServerOrigin, resolveServerUrl } from "./lib/fetch-json.ts";
import { Navigate, useLocation } from "./lib/hash-router.tsx";
import { listenWindowEvent } from "./lib/react-events.ts";
import { readStoredBoolean, writeStoredValue } from "./lib/stored-json.ts";
import { wsClient } from "./lib/websocket.ts";
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

const AgentPage = lazy(() =>
	import("./pages/Agent").then((m) => ({ default: m.AgentPage })),
);
const QuickFileOverlay = lazy(() =>
	import("./components/file/QuickFileOverlay.tsx").then((m) => ({
		default: m.QuickFileOverlay,
	})),
);
const AutomationsPage = lazy(() =>
	import("./pages/AutomationsPage").then((m) => ({
		default: m.AutomationsPage,
	})),
);
const ImagesPage = lazy(() =>
	import("./pages/ImagesPage").then((m) => ({ default: m.ImagesPage })),
);
const OnboardingPage = lazy(() =>
	import("./pages/OnboardingPage").then((m) => ({
		default: m.OnboardingPage,
	})),
);
const ProfilePage = lazy(() =>
	import("./pages/ProfilePage").then((m) => ({ default: m.ProfilePage })),
);
const PromptsPage = lazy(() =>
	import("./pages/PromptsPage").then((m) => ({ default: m.PromptsPage })),
);
const SessionsPage = lazy(() =>
	import("./pages/SessionsPage").then((m) => ({ default: m.SessionsPage })),
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
				init,
			);
		}
		if (input instanceof Request) {
			const url = new URL(input.url, window.location.origin);
			if (url.pathname.startsWith("/")) {
				return originalFetch(
					new Request(resolveServerUrl(`${url.pathname}${url.search}`), input),
					init,
				);
			}
		}
		return originalFetch(input, init);
	}) as typeof window.fetch;
}

await hydrateStoredValues();
// Main view is a launch target, not a durable workspace choice.
writeStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY, DEFAULT_AGENT_MAIN_VIEW);

const onboardingDone = readStoredBoolean(ONBOARDING_DONE_STORAGE_KEY);
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
		backgroundColor: "#050506",
		backgroundImage:
			"radial-gradient(rgba(255,255,255,0.055) 0.65px, transparent 0.75px)",
		backgroundPosition: "0 0",
		backgroundSize: "22px 22px",
		display: "flex",
		flexDirection: "column",
		height: "100vh",
		isolation: "isolate",
		overflow: "hidden",
		position: "relative",
	},
	backgroundLayer: {
		backgroundPosition: "center",
		backgroundRepeat: "no-repeat",
		backgroundSize: "cover",
		inset: -24,
		pointerEvents: "none",
		position: "absolute",
		zIndex: 0,
	},
	backgroundShade: {
		inset: 0,
		pointerEvents: "none",
		position: "absolute",
		zIndex: 0,
	},
	windowSpacer: {
		backgroundColor: color.background,
		flexShrink: 0,
		height: "1.5rem",
	},
	appBody: {
		display: "flex",
		flex: 1,
		gap: 10,
		minHeight: 0,
		paddingTop: 36,
		paddingRight: 12,
		paddingBottom: 12,
		paddingLeft: 12,
		position: "relative",
		zIndex: 1,
	},
	mainColumn: {
		position: "relative",
		backgroundColor: color.shellSurface,
		borderColor: color.shellFrame,
		borderRadius: 17,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow:
			"inset 0 1px 0 rgba(255,255,255,0.055), 0 28px 80px rgba(0,0,0,0.52), 0 0 0 1px rgba(0,0,0,0.42)",
		backdropFilter: "blur(var(--inferay-glass-blur, 4px)) saturate(104%)",
		display: "flex",
		flex: 1,
		flexDirection: "column",
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
	styles.shell,
);
const routeElements = {
	agent: <AgentPage />,
	prompts: <PromptsPage />,
	sessions: <SessionsPage />,
	automations: <AutomationsPage />,
	images: <ImagesPage />,
	profile: <ProfilePage />,
} satisfies Record<AppRouteId, unknown>;
const fallbackRouteElement = <Navigate to={DEFAULT_APP_ROUTE} replace />;

function QuickFileOverlayHost() {
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		if (mounted) return;
		return listenWindowEvent("keydown", (event) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setMounted(true);
			}
		});
	}, [mounted]);
	if (!mounted) return null;
	return (
		<Suspense fallback={null}>
			<QuickFileOverlay initiallyOpen />
		</Suspense>
	);
}

function AppShell() {
	const location = useLocation();
	const [background, setBackground] = useState(loadAppBackgroundSettings);
	useEffect(() => {
		wsClient.connect();
	}, []);
	useEffect(
		() =>
			listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
				const key = (event as CustomEvent<{ key?: string }>).detail?.key;
				if (
					key === APP_BACKGROUND_STORAGE_KEY ||
					key === APP_THEME_STORAGE_KEY
				) {
					setBackground(loadAppBackgroundSettings());
				}
			}),
		[],
	);
	const builtInPath = getBuiltInBackgroundPath(background.id);
	const backgroundUrl =
		background.id === "custom"
			? `${resolveServerUrl("/api/config/background-image")}?v=${background.customRevision}`
			: builtInPath
				? resolveServerUrl(builtInPath)
				: null;
	const activeRoute = APP_PAGE_ROUTES.find(
		(route) => route.path === location.pathname,
	);
	useEffect(() => {
		let active = true;
		if (!background.autoTheme) {
			restoreAppTheme();
			return;
		}
		void deriveAppBackgroundPalette(background.id, backgroundUrl)
			.then((palette) => {
				if (active) applyAppBackgroundPalette(palette);
			})
			.catch(() => {
				if (active) restoreAppTheme();
			});
		return () => {
			active = false;
		};
	}, [background.autoTheme, background.id, backgroundUrl]);

	return (
		<div
			{...shellThemeProps}
			style={
				{
					"--inferay-glass-blur": `${background.glassBlur}px`,
				} as CSSProperties
			}
		>
			<div
				aria-hidden="true"
				{...stylex.props(styles.backgroundLayer)}
				style={
					{
						backgroundImage: backgroundUrl ? `url("${backgroundUrl}")` : "none",
						filter: `blur(${background.blur}px)`,
					} as CSSProperties
				}
			/>
			<div
				aria-hidden="true"
				{...stylex.props(styles.backgroundShade)}
				style={{
					background: `radial-gradient(ellipse at center, rgba(0, 0, 0, ${Math.min(0.78, background.dim / 100 + 0.08)}) 0%, rgba(0, 0, 0, ${Math.min(0.88, background.dim / 100 + 0.18)}) 100%)`,
				}}
			/>
			<AgentShellHeader />
			<div {...stylex.props(styles.appBody)}>
				<Sidebar />
				<div {...stylex.props(styles.mainColumn)}>
					<main {...stylex.props(styles.mainContent)}>
						<Suspense fallback={null}>
							{activeRoute
								? routeElements[activeRoute.id]
								: fallbackRouteElement}
						</Suspense>
					</main>
				</div>
			</div>
			<QuickFileOverlayHost />
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

function AppRouter() {
	const location = useLocation();
	if (location.pathname === "/") {
		return <Navigate to={defaultRoute} replace />;
	}
	if (location.pathname === "/onboarding") return <OnboardingShell />;
	return <AppShell />;
}

root.render(
	<ErrorBoundary>
		<Suspense fallback={null}>
			<AppRouter />
		</Suspense>
	</ErrorBoundary>,
);
