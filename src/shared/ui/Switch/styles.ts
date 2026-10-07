import * as stylex from "@stylexjs/stylex";
import { color } from "../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	track: {
		display: "inline-flex",
		alignItems: "center",
		width: 30,
		height: 18,
		padding: 2,
		boxSizing: "border-box",
		border: 0,
		borderRadius: 20,
		backgroundColor: color.border,
		cursor: "pointer",
		flexShrink: 0,
		transition: "background-color 150ms",
		":disabled": { opacity: 0.45, cursor: "default" },
	},
	active: { backgroundColor: "#528fe8" },
	thumb: {
		width: 14,
		height: 14,
		borderRadius: "50%",
		backgroundColor: "white",
		boxShadow: "0 1px 3px #0003",
		transform: "translateX(0)",
		transition: "transform 150ms",
	},
	checked: { transform: "translateX(12px)" },
});
