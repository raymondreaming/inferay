import * as stylex from "@octanejs/stylex";
import {
	color,
	controlSize,
	font,
	radius,
} from "../../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	root: {
		alignItems: "center",
		backgroundColor: color.background,
		display: "flex",
		height: "100%",
		justifyContent: "center",
		minHeight: controlSize._0,
		padding: controlSize._4,
	},
	card: {
		alignItems: "center",
		backgroundColor: color.backgroundRaised,
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		maxWidth: 320,
		padding: controlSize._5,
		textAlign: "center",
	},
	title: {
		color: color.textMain,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
	},
	message: {
		color: color.textMuted,
		fontSize: font.size_2,
	},
});
