import * as stylex from "@octanejs/stylex";
import {
	color,
	controlSize,
	radius,
} from "../../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	handle: {
		display: "grid",
		width: controlSize._5,
		height: controlSize._5,
		flexShrink: 0,
		gridTemplateColumns: "repeat(2, 3px)",
		gridTemplateRows: "repeat(3, 3px)",
		alignContent: "center",
		justifyContent: "center",
		gap: controlSize._0_5,
		borderRadius: radius.sm,
		borderWidth: 0,
		padding: controlSize._0,
		touchAction: "none",
		userSelect: "none",
		cursor: { default: "grab", ":active": "grabbing" },
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceControl,
		},
	},
	dot: {
		width: controlSize._0_5,
		height: controlSize._0_5,
		borderRadius: radius.pill,
		backgroundColor: color.textMuted,
	},
});
