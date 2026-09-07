import * as stylex from "@octanejs/stylex";
import { Outlet } from "@octanejs/tanstack-router";
import { Suspense, useEffect } from "octane";
import type { CSSProperties } from "react";
import { wsClient } from "../../../adapters/backend/http.ts";
import { SettingsModalHost } from "../../../modules/settings/components/SettingsModal/index.tsx";
import { SkillsModalHost } from "../../../modules/skills/components/SkillsModal/index.tsx";
import { RepositoryWorkspaceBar } from "../../../modules/workspace/components/RepositoryWorkspaceBar/index.tsx";
import { WorkspaceSidebar } from "../../../modules/workspace/components/WorkspaceSidebar/index.tsx";
import { useAppAppearance } from "../../hooks/useAppAppearance.tsx";
import { AppHeader } from "../AppHeader/index.tsx";
import * as inlineStyles from "./styles.ts";
import { shellThemeProps, styles } from "./styles.ts";

export function AppLayout() {
	const { background, backgroundUrl } = useAppAppearance();
	useEffect(() => {
		wsClient.connect();
	}, []);

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
			<div {...stylex.props(styles.appBody, styles.appBodySidebarOpen)}>
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
