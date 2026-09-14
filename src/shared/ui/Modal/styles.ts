import * as stylex from "@stylexjs/stylex";
import {
	color,
	controlSize,
	radius,
} from "../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	dialog: {
		position: "fixed",
		inset: 0,
		margin: "auto",
		boxSizing: "border-box",
		color: color.textMain,
		borderRadius: radius._2xl,
		maxWidth: "calc(100vw - 32px)",
		maxHeight: "calc(100dvh - 48px)",
		padding: 0,
		overflow: "hidden",
		"::backdrop": {
			backgroundColor: "rgba(0, 0, 0, 0.4)",
		},
	},
	close: {
		position: "absolute",
		top: controlSize._3,
		right: controlSize._3,
		zIndex: 1,
	},
});
