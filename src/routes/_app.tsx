import * as stylex from "@octanejs/stylex";
import {
	createFileRoute,
	Outlet,
	useLocation,
} from "@octanejs/tanstack-router";
import { Suspense, useEffect, useState } from "octane";
import type { CSSProperties } from "react";
import { resolveServerUrl } from "../adapters/backend/http.ts";
import { wsClient } from "../adapters/backend/websocket.ts";
import {
	APP_BACKGROUND_STORAGE_KEY,
	APP_FONT_STORAGE_KEY,
	APP_THEME_STORAGE_KEY,
} from "../adapters/storage/keys.ts";
import {
	readStoredBoolean,
	readStoredValue,
} from "../adapters/storage/stored-values.ts";
import { CLIENT_STORAGE_CHANGED_EVENT } from "../adapters/storage/sync.ts";
import { AppHeader } from "../app/components/AppHeader.tsx";
import {
	applyAppBackgroundPalette,
	deriveAppBackgroundPalette,
	getBuiltInBackgroundPath,
	loadAppBackgroundSettings,
	restoreAppTheme,
} from "../app/model/background.ts";
import { applyAppFont, loadAppFontId } from "../app/model/font.ts";
import { WorkspaceSidebar } from "../modules/workspace/index.ts";
import { listenWindowEvent } from "../shared/lib/react-events.ts";
import { color, controlSize, layer, radius } from "../tokens.stylex.ts";

export const Route = createFileRoute("/_app")({ component: AppLayout });

const styles = stylex.create({
	shell: {
		backgroundColor: "var(--inferay-app-background, #050506)",
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
		zIndex: layer.base,
	},
	backgroundShade: {
		inset: controlSize._0,
		pointerEvents: "none",
		position: "absolute",
		zIndex: layer.base,
	},
	glassBackdrop: {
		inset: controlSize._0,
		pointerEvents: "none",
		position: "absolute",
		zIndex: layer.base,
	},
	appBody: {
		display: "flex",
		flex: 1,
		gap: controlSize._2_5,
		minHeight: controlSize._0,
		paddingTop: controlSize._9,
		paddingRight: controlSize._3,
		paddingBottom: controlSize._3,
		paddingLeft: controlSize._0,
		position: "relative",
		zIndex: layer.content,
	},
	appBodySidebarOpen: {
		paddingLeft: controlSize._3,
	},
	mainColumn: {
		position: "relative",
		backgroundColor: color.shellSurface,
		borderColor: color.shellFrame,
		borderRadius: radius.px17,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow:
			"inset 0 1px 0 rgba(255,255,255,0.055), 0 28px 80px rgba(0,0,0,0.52), 0 0 0 1px rgba(0,0,0,0.42)",
		backdropFilter:
			"var(--inferay-panel-backdrop, blur(var(--inferay-glass-blur, 4px)) saturate(104%))",
		display: "flex",
		flex: 1,
		flexDirection: "column",
		minWidth: controlSize._0,
		overflow: "hidden",
	},
	mainContent: { flex: 1, minWidth: controlSize._0, overflow: "hidden" },
});

const shellThemeProps = stylex.props(styles.shell);

function AppLayout() {
	const location = useLocation();
	const [background, setBackground] = useState(loadAppBackgroundSettings);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
		readStoredBoolean("sidebar-collapsed"),
	);
	const [mainView, setMainView] = useState(
		() => readStoredValue("agent-main-view") ?? "chat",
	);
	const sidebarOpen =
		location.pathname === "/agent" && mainView === "chat" && !sidebarCollapsed;
	useEffect(() => {
		wsClient.connect();
	}, []);
	useEffect(
		() =>
			listenWindowEvent("toggle-main-sidebar", () =>
				setSidebarCollapsed((current) => !current),
			),
		[],
	);
	useEffect(
		() =>
			listenWindowEvent("agent-shell-change", () => {
				setMainView(readStoredValue("agent-main-view") ?? "chat");
			}),
		[],
	);
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
				if (key === APP_FONT_STORAGE_KEY) applyAppFont(loadAppFontId());
			}),
		[],
	);
	const builtInPath = getBuiltInBackgroundPath(background.id);
	const backgroundUrl =
		background.mode !== "scene"
			? null
			: background.id === "custom"
				? `${resolveServerUrl("/api/config/background-image")}?v=${background.customRevision}`
				: builtInPath
					? resolveServerUrl(builtInPath)
					: null;

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
			data-background-mode={background.mode}
			style={
				{
					"--inferay-app-background":
						background.mode === "glass" ? "transparent" : "#000000",
					"--inferay-glass-blur": `${background.glassBlur}px`,
					"--inferay-glass-surface":
						background.mode === "glass"
							? "transparent"
							: `color-mix(in srgb, var(--color-inferay-black) ${background.glassOpacity}%, transparent)`,
					"--inferay-panel-backdrop":
						background.mode === "glass" ? "none" : undefined,
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
			{background.mode === "glass" ? (
				<div
					aria-hidden="true"
					data-glass-backdrop="true"
					{...stylex.props(styles.glassBackdrop)}
					style={{
						WebkitBackdropFilter: `blur(${background.glassBlur}px) saturate(115%)`,
						backdropFilter: `blur(${background.glassBlur}px) saturate(115%)`,
						backgroundColor: `color-mix(in srgb, #000000 ${background.glassOpacity}%, transparent)`,
					}}
				/>
			) : null}
			<div
				aria-hidden="true"
				{...stylex.props(styles.backgroundShade)}
				style={{
					background:
						background.mode === "scene"
							? `radial-gradient(ellipse at center, rgba(0, 0, 0, ${Math.min(0.78, background.dim / 100 + 0.08)}) 0%, rgba(0, 0, 0, ${Math.min(0.88, background.dim / 100 + 0.18)}) 100%)`
							: "none",
				}}
			/>
			<AppHeader />
			<div
				{...stylex.props(
					styles.appBody,
					sidebarOpen && styles.appBodySidebarOpen,
				)}
			>
				<WorkspaceSidebar />
				<div {...stylex.props(styles.mainColumn)}>
					<main {...stylex.props(styles.mainContent)}>
						<Suspense fallback={null}>
							<Outlet />
						</Suspense>
					</main>
				</div>
			</div>
		</div>
	);
}
