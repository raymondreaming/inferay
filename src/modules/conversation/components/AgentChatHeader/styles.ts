import * as stylex from "@octanejs/stylex";
import {
	color,
	controlSize,
	font,
	radius,
} from "../../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	projectButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		borderRadius: radius.md,
		borderWidth: 0,
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
		cursor: "pointer",
		display: "inline-flex",
		flexShrink: 1,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		height: controlSize._7,
		maxWidth: "12rem",
		minWidth: controlSize._0,
		overflow: "hidden",
		paddingBlock: controlSize._0,
		paddingInline: controlSize._2,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	projectButtonActive: {
		backgroundColor: color.controlActive,
		color: color.textMain,
	},

	sessionLabel: {
		fontSize: font.size_1,
		maxWidth: "120px",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
});
