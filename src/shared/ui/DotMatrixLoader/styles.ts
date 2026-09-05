import * as stylex from "@octanejs/stylex";
import type { CSSProperties } from "react";
import {
	color,
	controlSize,
	font,
	radius,
} from "../../../design-system/styles.stylex.ts";

const rippleEcho = stylex.keyframes({
	"0%, 100%": { opacity: 0.1 },
	"28%": { opacity: 0.98 },
	"56%": { opacity: 0.32 },
	"78%": { opacity: 0.78 },
});

const spiralFade = stylex.keyframes({
	"0%, 100%": { opacity: 0.15 },
	"8%": { opacity: 1 },
	"16%": { opacity: 0.73 },
	"24%": { opacity: 0.56 },
	"32%": { opacity: 0.4 },
	"40%": { opacity: 0.22 },
});

const weaveStrand = stylex.keyframes({
	"0%, 100%": {
		opacity: 0.08,
		transform: "scale(0.72)",
	},
	"45%": {
		opacity: 1,
		transform: "scale(1)",
	},
	"76%": {
		opacity: 0.34,
		transform: "scale(0.88)",
	},
});

export const styles = stylex.create({
	matrixGrid: {
		display: "grid",
		flexShrink: 0,
	},
	rippleDot: {
		animationDelay:
			"calc(var(--dmx-ripple-ring, 0) * 0.14 * var(--dmx-cycle, 1500ms) + var(--dmx-ripple-parity, 0) * 0.03 * var(--dmx-cycle, 1500ms))",
		animationDuration: "var(--dmx-cycle, 1500ms)",
		animationIterationCount: "infinite",
		animationName: rippleEcho,
		animationTimingFunction: "ease-in-out",
		backgroundColor: color.textSoft,
		borderRadius: radius.px1,
		display: "block",
		willChange: "opacity",
	},
	spiralDot: {
		animationDelay:
			"calc(var(--dmx-spiral-order, 0) * 0.04 * var(--dmx-cycle, 2400ms))",
		animationDuration: "var(--dmx-cycle, 2400ms)",
		animationIterationCount: "infinite",
		animationName: spiralFade,
		animationTimingFunction: "linear",
		backgroundColor: color.textSoft,
		borderRadius: radius.px1,
		display: "block",
		willChange: "opacity",
	},
	thinkingRow: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._1_5,
		flexShrink: 0,
	},
	thinkingTime: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
		fontVariantNumeric: "tabular-nums",
	},
	weaveSlot: {
		alignItems: "center",
		borderRadius: radius.sm,
		color: "currentColor",
		display: "inline-flex",
		flexShrink: 0,
		justifyContent: "center",
	},
	weaveGrid: {
		display: "grid",
		flexShrink: 0,
	},
	weaveDot: {
		animationDelay:
			"calc((var(--dmx-weave-row, 0) * 0.13 + var(--dmx-weave-center-distance, 0) * 0.08) * -1 * var(--dmx-weave-cycle, 1600ms))",
		animationDirection: "alternate",
		animationDuration: "var(--dmx-weave-cycle, 1600ms)",
		animationIterationCount: "infinite",
		animationName: weaveStrand,
		animationTimingFunction: "ease",
		backgroundColor: "currentColor",
		borderRadius: radius.pill,
		display: "block",
		willChange: "opacity, transform",
	},
	weaveDotBase: {
		opacity: 0.16,
	},
	weaveDotPeak: {
		opacity: 0.58,
	},
});

export function getDotMatrixRippleMatrixGridStyle(
	gridTemplateColumns: CSSProperties["gridTemplateColumns"],
	gridTemplateRows: CSSProperties["gridTemplateRows"],
	gap: CSSProperties["gap"],
): CSSProperties {
	return {
		gridTemplateColumns: gridTemplateColumns,
		gridTemplateRows: gridTemplateRows,
		gap: gap,
	} as CSSProperties;
}

export function getDotMatrixRippleRippleDotStyle(
	width: CSSProperties["width"],
	height: CSSProperties["height"],
	dmxcycle: string | number | undefined,
	dmxripplering: string | number | undefined,
	dmxrippleparity: string | number | undefined,
): CSSProperties {
	return {
		width: width,
		height: height,
		"--dmx-cycle": dmxcycle,
		"--dmx-ripple-ring": dmxripplering,
		"--dmx-ripple-parity": dmxrippleparity,
	} as CSSProperties;
}

export function getDotMatrixWeaveWeaveSlotStyle(
	height: CSSProperties["height"],
	width: CSSProperties["width"],
): CSSProperties {
	return { height: height, width: width } as CSSProperties;
}

export function getDotMatrixWeaveWeaveGridStyle(
	gridTemplateColumns: CSSProperties["gridTemplateColumns"],
	gridTemplateRows: CSSProperties["gridTemplateRows"],
	gap: CSSProperties["gap"],
	dmxweavecycle: string | number | undefined,
): CSSProperties {
	return {
		gridTemplateColumns: gridTemplateColumns,
		gridTemplateRows: gridTemplateRows,
		gap: gap,
		"--dmx-weave-cycle": dmxweavecycle,
	} as CSSProperties;
}

export function getDotMatrixWeaveWeaveDotStyle(
	height: CSSProperties["height"],
	dmxweavecenterdistance: string | number | undefined,
	dmxweaverow: string | number | undefined,
	width: CSSProperties["width"],
): CSSProperties {
	return {
		height: height,
		"--dmx-weave-center-distance": dmxweavecenterdistance,
		"--dmx-weave-row": dmxweaverow,
		width: width,
	} as CSSProperties;
}

export function getDotMatrixLoaderMatrixGridStyle(
	gridTemplateColumns: CSSProperties["gridTemplateColumns"],
	gridTemplateRows: CSSProperties["gridTemplateRows"],
	gap: CSSProperties["gap"],
): CSSProperties {
	return {
		gridTemplateColumns: gridTemplateColumns,
		gridTemplateRows: gridTemplateRows,
		gap: gap,
	} as CSSProperties;
}

export function getDotMatrixLoaderSpiralDotStyle(
	width: CSSProperties["width"],
	height: CSSProperties["height"],
	dmxcycle: string | number | undefined,
	dmxspiralorder: string | number | undefined,
): CSSProperties {
	return {
		width: width,
		height: height,
		"--dmx-cycle": dmxcycle,
		"--dmx-spiral-order": dmxspiralorder,
	} as CSSProperties;
}
