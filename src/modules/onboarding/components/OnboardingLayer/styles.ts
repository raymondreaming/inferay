import type { CSSProperties } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import {
	color,
	controlSize,
	font,
	layer,
	motion,
	radius,
} from "../../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	root: {
		position: "fixed",
		inset: 0,
		zIndex: layer.navigationPopover,
		pointerEvents: "none",
	},
	spotlight: {
		position: "absolute",
		borderRadius: radius.xl,
		["--beam-radius" as string]: radius.xl,
		borderColor: color.borderSubtle,
		borderStyle: "solid",
		borderWidth: 1,
		transitionDuration: motion.durationDeliberate,
		transitionProperty: "top, left, width, height",
		transitionTimingFunction: motion.easeStandard,
	},
	spotlightTight: {
		borderRadius: radius.md,
		["--beam-radius" as string]: radius.md,
		borderColor: color.transparent,
	},
	card: {
		position: "absolute",
		top: 0,
		left: 0,
		boxSizing: "border-box",
		width: 344,
		maxWidth: "calc(100vw - 32px)",
		padding: controlSize._4,
		borderRadius: radius.xl,
		color: color.textMain,
		pointerEvents: "auto",
		display: "flex",
		flexDirection: "column",
		gap: controlSize._3,
		transitionDuration: motion.durationDeliberate,
		transitionProperty: "transform",
		transitionTimingFunction: motion.easeStandard,
	},
	arrow: {
		position: "absolute",
		width: 10,
		height: 10,
		backgroundColor: color.backgroundPanel,
		borderColor: color.border,
		borderStyle: "solid",
		borderWidth: 1,
		transform: "rotate(45deg)",
	},
	header: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: controlSize._2,
	},
	eyebrow: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._1_5,
		color: color.textMuted,
		fontSize: font.size_1,
		letterSpacing: "0.08em",
		textTransform: "uppercase",
	},
	headerEnd: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._1_5,
	},
	title: {
		fontSize: font.size_6,
		fontWeight: font.weight_6,
		lineHeight: 1.25,
	},
	body: {
		color: color.textSoft,
		fontSize: font.size_4,
		lineHeight: 1.55,
	},
	keys: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1_5,
	},
	keyRow: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
		fontSize: font.size_2,
		color: color.textMuted,
	},
	keyCluster: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._0_75,
	},
	key: {
		minWidth: controlSize._5,
		padding: `${controlSize._0_5} ${controlSize._1_25}`,
		borderRadius: radius.sm,
		borderColor: color.border,
		borderStyle: "solid",
		borderWidth: 1,
		backgroundColor: color.surfaceWhite04,
		color: color.textSoft,
		fontFamily: "inherit",
		fontSize: font.size_1,
		textAlign: "center",
	},
	task: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
		padding: `${controlSize._2} ${controlSize._2_5}`,
		borderRadius: radius.lg,
		borderColor: color.border,
		borderStyle: "solid",
		borderWidth: 1,
		backgroundColor: color.surfaceWhite025,
		fontSize: font.size_3,
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, border-color, color",
	},
	taskDone: {
		borderColor: color.successBorderSoft,
		backgroundColor: color.successWash,
		color: color.successText,
	},
	taskIcon: {
		display: "flex",
		flexShrink: 0,
	},
	actions: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: controlSize._2,
	},
	trail: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._1,
	},
	dot: {
		width: controlSize._1_5,
		height: controlSize._1_5,
		borderRadius: radius.pill,
		backgroundColor: color.surfaceWhite15,
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, width",
	},
	dotVisited: {
		backgroundColor: color.surfaceWhite40,
	},
	dotCurrent: {
		width: controlSize._4,
		backgroundColor: color.textMain,
	},
	buttons: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._1_5,
	},
	beamHost: {
		position: "relative",
	},
});

export function getSpotlightStyle(
	left: CSSProperties["left"],
	top: CSSProperties["top"],
	width: CSSProperties["width"],
	height: CSSProperties["height"],
	beamScale: number,
): CSSProperties {
	return {
		left,
		top,
		width,
		height,
		"--beam-scale": String(beamScale),
	} as CSSProperties;
}

export function getCardStyle(
	transform: CSSProperties["transform"],
	opacity: CSSProperties["opacity"],
): CSSProperties {
	return { transform, opacity } as CSSProperties;
}

export function getArrowStyle(
	left: CSSProperties["left"],
	top: CSSProperties["top"],
	clipPath: CSSProperties["clipPath"],
): CSSProperties {
	return { left, top, clipPath } as CSSProperties;
}
