import type { CSSProperties } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import {
	color,
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
