import * as stylex from "@octanejs/stylex";
import {
	color,
	controlSize,
	effect,
	font,
	radius,
} from "../../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	transparent: {
		color: color.transparent,
	},
	text: {
		color: color.textMain,
	},
	highlight: {
		backgroundColor: effect.tokenHighlightBackground,
		borderRadius: radius.xs,
		color: color.accent,
	},
	pill: {
		alignItems: "center",
		alignSelf: "center",
		backgroundColor: effect.tokenHighlightBackground,
		borderRadius: radius.pill,
		color: color.accent,
		display: "inline-flex",
		fontSize: font.size_3,
		fontWeight: font.weight_5,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._1_5,
		verticalAlign: "middle",
	},
});
