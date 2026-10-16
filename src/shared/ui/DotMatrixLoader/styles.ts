import * as stylex from "@stylexjs/stylex";
import {
	color,
	controlSize,
	font,
	radius,
} from "../../../design-system/styles.stylex.ts";

const rippleEcho = stylex.keyframes({
	"0%, 100%": {
		opacity: 0.1,
	},
	"28%": {
		opacity: 0.98,
	},
	"56%": {
		opacity: 0.32,
	},
	"78%": {
		opacity: 0.78,
	},
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
		gridTemplateColumns: "repeat(5, var(--dmx-dot-size, 2px))",
		gridTemplateRows: "repeat(5, var(--dmx-dot-size, 2px))",
		gap: "var(--dmx-gap, 1px)",
	},
	dot: {
		width: "var(--dmx-dot-size, 2px)",
		height: "var(--dmx-dot-size, 2px)",
		display: "block",
		animationDuration: "var(--dmx-cycle)",
		animationDelay: "calc(var(--dmx-delay) * var(--dmx-cycle))",
		animationIterationCount: "infinite",
	},
	rippleDot: {
		animationName: rippleEcho,
		animationTimingFunction: "ease-in-out",
		backgroundColor: color.textSoft,
		borderRadius: radius.px1,
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
		display: "inline-grid",
		alignContent: "center",
		justifyContent: "center",
		width: "var(--dmx-slot-size, 15px)",
		height: "var(--dmx-slot-size, 15px)",
		borderRadius: radius.sm,
		color: "currentColor",
	},
	weaveDot: {
		animationDirection: "alternate",
		animationName: weaveStrand,
		animationTimingFunction: "ease",
		backgroundColor: "currentColor",
		borderRadius: radius.pill,
		willChange: "opacity, transform",
	},
	weaveDotBase: {
		opacity: 0.16,
	},
	weaveDotPeak: {
		opacity: 0.58,
	},
});
