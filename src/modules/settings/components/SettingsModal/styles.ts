import * as stylex from "@octanejs/stylex";
import type { CSSProperties } from "react";
import {
	breakpoint,
	color,
	controlSize,
	font,
	layer,
	radius,
	shadow,
} from "../../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	backdrop: {
		backdropFilter: "blur(14px)",
		backgroundColor: "rgba(0, 0, 0, 0.64)",
		display: "grid",
		inset: controlSize._0,
		overflow: "hidden",
		placeItems: "center",
		position: "fixed",
		zIndex: layer.criticalOverlay,
	},
	modal: {
		backgroundColor: color.backgroundModal,
		borderColor: color.borderStrong,
		borderRadius: radius._2xl,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.modal,
		display: "grid",
		gridTemplateColumns: {
			default: "3.75rem minmax(0, 1fr)",
			[breakpoint.tablet]: "11.5rem minmax(0, 1fr)",
		},
		height: "min(42rem, calc(100dvh - 3rem))",
		maxHeight: "calc(100dvh - 3rem)",
		maxWidth: "calc(100dvw - 3rem)",
		overflow: "hidden",
		width: "min(58rem, calc(100dvw - 3rem))",
	},
	sidebar: {
		backgroundColor: color.surfaceWhite025,
		borderRightColor: color.border,
		borderRightStyle: "solid",
		borderRightWidth: 1,
		display: "flex",
		flexDirection: "column",
		minHeight: controlSize._0,
		padding: controlSize._3,
	},
	brand: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._2,
		height: controlSize._10,
		paddingInline: controlSize._2,
	},
	brandIcon: {
		alignItems: "center",
		color: color.textSoft,
		display: "inline-flex",
		flexShrink: 0,
		justifyContent: "center",
	},
	brandTitle: {
		color: color.textMain,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
		display: {
			default: "none",
			[breakpoint.tablet]: "inline",
		},
	},
	nav: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		marginTop: controlSize._3,
	},
	navItem: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceWhite04,
		},
		borderRadius: radius.md,
		color: color.textMuted,
		display: "flex",
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		gap: controlSize._2,
		height: controlSize._9,
		justifyContent: {
			default: "center",
			[breakpoint.tablet]: "flex-start",
		},
		paddingInline: controlSize._2,
		textAlign: "left",
		width: "100%",
	},
	navItemSelected: {
		backgroundColor: color.surfaceWhite075,
		color: color.textMain,
	},
	main: {
		display: "flex",
		flexDirection: "column",
		minHeight: controlSize._0,
		minWidth: controlSize._0,
	},
	header: {
		alignItems: "center",
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		flexShrink: 0,
		justifyContent: "space-between",
		minHeight: controlSize._16,
		paddingBlock: controlSize._3,
		paddingInline: controlSize._6,
	},
	heading: {
		minWidth: controlSize._0,
	},
	title: {
		color: color.textMain,
		fontSize: font.size_4,
		fontWeight: font.weight_6,
		letterSpacing: "-0.008em",
		margin: controlSize._0,
	},
	subtitle: {
		color: color.textMuted,
		fontSize: font.size_1,
		marginBlockEnd: controlSize._0,
		marginBlockStart: controlSize._0_5,
	},
	content: {
		flex: 1,
		minHeight: controlSize._0,
		overscrollBehavior: "contain",
		overflowY: "auto",
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
		gridTemplateColumns: "clamp(60px, 20vw, 184px) minmax(0, 1fr)",
		height: "min(672px, calc(100vh - 48px))",
		maxHeight: "calc(100vh - 48px)",
		maxWidth: "calc(100vw - 48px)",
		overflow: "hidden",
		width: "min(928px, calc(100vw - 48px))",
	} as CSSProperties;
}
