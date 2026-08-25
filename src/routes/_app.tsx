import * as stylex from "@octanejs/stylex";
import { createFileRoute, Outlet } from "@octanejs/tanstack-router";
import { Suspense, useEffect, useState } from "octane";
import type { CSSProperties } from "react";
import { AgentShellHeader } from "../components/layout/AgentShellHeader.tsx";
import { Sidebar } from "../components/layout/Sidebar.tsx";
import {
	applyAppBackgroundPalette,
	deriveAppBackgroundPalette,
	getBuiltInBackgroundPath,
	loadAppBackgroundSettings,
	restoreAppTheme,
} from "../lib/app-background.ts";
import {
	APP_BACKGROUND_STORAGE_KEY,
	APP_THEME_STORAGE_KEY,
} from "../lib/client-storage-keys.ts";
import { CLIENT_STORAGE_CHANGED_EVENT } from "../lib/client-storage-sync.ts";
import { resolveServerUrl } from "../lib/fetch-json.ts";
import { listenWindowEvent } from "../lib/react-events.ts";
import { wsClient } from "../lib/websocket.ts";
import {
	color,
	colorTheme,
	controlSizeTheme,
	effectTheme,
	fontTheme,
	motionTheme,
	radiusTheme,
	shadowTheme,
} from "../tokens.stylex.ts";

export const Route = createFileRoute("/_app")({ component: AppLayout });

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
	mainContent: { flex: 1, minWidth: 0, overflow: "hidden" },
});

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

function AppLayout() {
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
				{ "--inferay-glass-blur": `${background.glassBlur}px` } as CSSProperties
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
							<Outlet />
						</Suspense>
					</main>
				</div>
			</div>
		</div>
	);
}
