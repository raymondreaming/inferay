import * as stylex from "@octanejs/stylex";
import {
	color,
	controlSize,
	font,
} from "../../../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	fallback: {
		alignItems: "center",
		backgroundColor: color.background,
		color: color.textMain,
		display: "flex",
		fontFamily: "var(--font-body)",
		height: "100%",
		justifyContent: "center",
		minHeight: 240,
		padding: controlSize._6,
		textAlign: "center",
	},
	title: {
		fontSize: font.size_4,
		fontWeight: font.weight_6,
	},
	description: {
		color: color.textMuted,
		fontSize: font.size_2,
		marginTop: controlSize._2,
		maxWidth: 520,
	},
});
