import * as stylex from "@octanejs/stylex";
import { Outlet, useLocation } from "@octanejs/tanstack-router";
import { Suspense, useEffect, useState } from "octane";
import type { CSSProperties } from "react";
import { resolveServerUrl } from "../../../adapters/backend/http.ts";
import { wsClient } from "../../../adapters/backend/websocket.ts";
import {
	APP_BACKGROUND_STORAGE_KEY,
	APP_FONT_STORAGE_KEY,
	APP_THEME_STORAGE_KEY,
} from "../../../adapters/storage/keys.ts";
import { CLIENT_STORAGE_CHANGED_EVENT } from "../../../adapters/storage/sync.ts";
import { SettingsModalHost } from "../../../modules/settings/components/SettingsModal/index.tsx";
import { SkillsModalHost } from "../../../modules/skills/components/SkillsModal/index.tsx";
import { RepositoryWorkspaceBar } from "../../../modules/workspace/components/RepositoryWorkspaceBar/index.tsx";
import { WorkspaceSidebar } from "../../../modules/workspace/components/WorkspaceSidebar/index.tsx";
import { listenWindowEvent } from "../../../shared/lib/react-events.ts";
import {
	applyAppBackgroundPalette,
	applyAppBackgroundSurfaces,
	deriveAppBackgroundPalette,
	getBuiltInBackgroundPath,
	loadAppBackgroundSettings,
	restoreAppTheme,
} from "../../model/appearance.ts";
import { applyAppFont, loadAppFontId } from "../../model/font.ts";
import { AppHeader } from "../AppHeader/index.tsx";
import * as inlineStyles from "./styles.ts";
import { shellThemeProps, styles } from "./styles.ts";

export function AppLayout() {
	const location = useLocation();
	const [background, setBackground] = useState(loadAppBackgroundSettings);
	const sidebarOpen = location.pathname === "/agent";
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
		applyAppBackgroundSurfaces(background.mode);
	}, [background.mode]);

	useEffect(() => {
		let active = true;
		if (!background.autoTheme) {
			restoreAppTheme();
			return;
		}
		void deriveAppBackgroundPalette(background.id, backgroundUrl)
			.then((palette) => {
				if (active) applyAppBackgroundPalette(palette, background.id);
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
				inlineStyles.getAppLayoutDivStyle(
					background.mode === "glass"
						? "transparent"
						: "var(--color-inferay-black)",
					`${background.glassBlur}px`,
					background.mode === "glass" ? "none" : undefined,
				) as CSSProperties
			}
		>
			<div
				aria-hidden="true"
				{...stylex.props(styles.backgroundLayer)}
				style={
					inlineStyles.getAppLayoutBackgroundLayerStyle(
						backgroundUrl ? `url("${backgroundUrl}")` : "none",
						`blur(${background.blur}px)`,
					) as CSSProperties
				}
			/>
			{background.mode === "glass" ? (
				<div
					aria-hidden="true"
					data-glass-backdrop="true"
					{...stylex.props(styles.glassBackdrop)}
					style={inlineStyles.getAppLayoutGlassBackdropStyle(
						`blur(${background.glassBlur}px) saturate(115%)`,
						`blur(${background.glassBlur}px) saturate(115%)`,
						`color-mix(in srgb, #000000 ${background.glassOpacity}%, transparent)`,
					)}
				/>
			) : null}
			<div
				aria-hidden="true"
				{...stylex.props(styles.backgroundShade)}
				style={inlineStyles.getAppLayoutBackgroundShadeStyle(
					background.mode === "scene"
						? `radial-gradient(ellipse at center, rgba(0, 0, 0, ${Math.min(0.78, background.dim / 100 + 0.08)}) 0%, rgba(0, 0, 0, ${Math.min(0.88, background.dim / 100 + 0.18)}) 100%)`
						: "none",
				)}
			/>
			<AppHeader />
			<RepositoryWorkspaceBar />
			<SettingsModalHost />
			<SkillsModalHost />
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
export { shellThemeProps, styles } from "./styles.ts";
