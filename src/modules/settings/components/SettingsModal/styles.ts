import * as stylex from "@stylexjs/stylex";
import {
	breakpoint,
	color,
	controlSize,
	font,
	layer,
	motion,
	radius,
} from "../../../../design-system/styles.stylex.ts";
import type { CSSProperties } from "../../../../shared/lib/dom.tsx";
export const styles = stylex.create({
	backdrop: {
		backdropFilter: "blur(7px)",
		backgroundColor: "rgba(0, 0, 0, 0.4)",
		display: "grid",
		inset: controlSize._0,
		overflow: "hidden",
		placeItems: "center",
		position: "fixed",
		zIndex: layer.criticalOverlay,
	},
	modal: {
		borderRadius: radius._2xl,
		display: "grid",
		gridTemplateColumns: {
			default: "3.5rem minmax(0, 1fr)",
			[breakpoint.tablet]: "12.5rem minmax(0, 1fr)",
		},
		height: "min(42rem, calc(100dvh - 3rem))",
		maxHeight: "calc(100dvh - 3rem)",
		maxWidth: "calc(100dvw - 3rem)",
		overflow: "hidden",
		width: "min(58rem, calc(100dvw - 3rem))",
	},
	sidebar: {
		backgroundColor: color.surfaceWhite02,
		borderRightColor: color.border,
		borderRightStyle: "solid",
		borderRightWidth: 1,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._4,
		minHeight: controlSize._0,
		paddingBlock: controlSize._4,
		paddingInline: controlSize._2,
	},
	searchWrap: {
		display: {
			default: "none",
			[breakpoint.tablet]: "block",
		},
		position: "relative",
	},
	searchIcon: {
		color: color.textMuted,
		left: controlSize._2_5,
		pointerEvents: "none",
		position: "absolute",
		top: "50%",
		transform: "translateY(-50%)",
	},
	searchInput: {
		backgroundColor: color.background,
		borderColor: {
			default: color.border,
			":focus": color.focusRing,
		},
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMain,
		fontSize: font.size_2,
		height: controlSize._8,
		outline: "none",
		paddingLeft: controlSize._7,
		paddingRight: controlSize._2,
		width: "100%",
		"::placeholder": {
			color: color.textMuted,
		},
	},
	nav: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._4,
		minHeight: controlSize._0,
		overflowY: "auto",
	},
	navGroup: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._0_5,
	},
	navGroupLabel: {
		color: color.textMuted,
		display: {
			default: "none",
			[breakpoint.tablet]: "block",
		},
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		letterSpacing: "0.02em",
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
	},
	navItem: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceWhite06,
		},
		borderRadius: radius.lg,
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
		display: "flex",
		fontSize: font.size_3,
		fontWeight: font.weight_5,
		gap: controlSize._2_5,
		minHeight: controlSize._8,
		justifyContent: {
			default: "center",
			[breakpoint.tablet]: "flex-start",
		},
		paddingInline: controlSize._2,
		textAlign: "left",
		transitionDuration: motion.durationFast,
		transitionProperty: "background-color, color",
		width: "100%",
	},
	navItemSelected: {
		backgroundColor: {
			default: color.surfaceWhite08,
			":hover": color.surfaceWhite08,
		},
		color: {
			default: color.textMain,
			":hover": color.textMain,
		},
	},
	navLabel: {
		display: {
			default: "none",
			[breakpoint.tablet]: "inline",
		},
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	navEmpty: {
		color: color.textMuted,
		fontSize: font.size_2,
		paddingInline: controlSize._2,
	},
	main: {
		display: "flex",
		flexDirection: "column",
		minHeight: controlSize._0,
		minWidth: controlSize._0,
		position: "relative",
	},
	close: {
		position: "absolute",
		right: controlSize._3,
		top: controlSize._3,
		zIndex: layer.control,
	},
	content: {
		flex: 1,
		minHeight: controlSize._0,
		overscrollBehavior: "contain",
		overflowY: "auto",
	},
	page: {
		boxSizing: "border-box",
		display: "flex",
		flexDirection: "column",
		gap: controlSize._6,
		marginInline: "auto",
		maxWidth: "44rem",
		paddingBlock: controlSize._6,
		paddingInline: controlSize._6,
		width: "100%",
	},
	pageTitle: {
		color: color.textMain,
		fontSize: font.size_7,
		fontWeight: font.weight_6,
		letterSpacing: "-0.012em",
		margin: controlSize._0,
		paddingRight: controlSize._8,
	},
});
export function getSettingsModalHostDivStyle(): CSSProperties {
	return {
		boxSizing: "border-box",
		display: "grid",
		inset: 0,
		padding: 24,
		placeItems: "center",
		position: "fixed",
	} as CSSProperties;
}
export function getSettingsModalHostSectionStyle(): CSSProperties {
	return {
		display: "grid",
		gridTemplateColumns: "clamp(56px, 22vw, 200px) minmax(0, 1fr)",
		height: "min(672px, calc(100vh - 48px))",
		maxHeight: "calc(100vh - 48px)",
		maxWidth: "calc(100vw - 48px)",
		overflow: "hidden",
		width: "min(928px, calc(100vw - 48px))",
	} as CSSProperties;
}
