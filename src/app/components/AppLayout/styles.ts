import * as stylex from "@octanejs/stylex";
import type { CSSProperties } from "react";

import {
	color,
	controlSize,
	layer,
	radius,
} from "../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	shell: {
		backgroundColor: "var(--inferay-app-background, #050506)",
		backgroundImage: "none",
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
		gap: controlSize._0,
		minHeight: controlSize._0,
		paddingTop: controlSize._0,
		paddingRight: controlSize._0,
		paddingBottom: controlSize._0,
		paddingLeft: controlSize._0,
		position: "relative",
		zIndex: layer.content,
	},
	appBodySidebarOpen: {
		paddingLeft: controlSize._0,
	},
	mainColumn: {
		position: "relative",
		backgroundColor: color.shellSurface,
		borderRadius: radius.none,
		borderWidth: controlSize._0,
		boxShadow: "none",
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

export const shellThemeProps = stylex.props(styles.shell);

export function getAppLayoutDivStyle(
	inferayappbackground: string | number | undefined,
	inferayglassblur: string | number | undefined,
	inferaypanelbackdrop: string | number | undefined,
): CSSProperties {
	return {
		"--inferay-app-background": inferayappbackground,
		"--inferay-glass-blur": inferayglassblur,
		"--inferay-panel-backdrop": inferaypanelbackdrop,
	} as CSSProperties;
}

export function getAppLayoutBackgroundLayerStyle(
	backgroundImage: CSSProperties["backgroundImage"],
	filter: CSSProperties["filter"],
): CSSProperties {
	return { backgroundImage: backgroundImage, filter: filter } as CSSProperties;
}

export function getAppLayoutGlassBackdropStyle(
	WebkitBackdropFilter: CSSProperties["WebkitBackdropFilter"],
	backdropFilter: CSSProperties["backdropFilter"],
	backgroundColor: CSSProperties["backgroundColor"],
): CSSProperties {
	return {
		WebkitBackdropFilter: WebkitBackdropFilter,
		backdropFilter: backdropFilter,
		backgroundColor: backgroundColor,
	} as CSSProperties;
}

export function getAppLayoutBackgroundShadeStyle(
	background: CSSProperties["background"],
): CSSProperties {
	return { background: background } as CSSProperties;
}
