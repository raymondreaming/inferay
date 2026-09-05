import * as stylex from "@octanejs/stylex";
import {
	color,
	controlSize,
	font,
	radius,
} from "../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	notice: {
		alignItems: "flex-start",
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		fontSize: font.size_1,
		gap: controlSize._2,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	warning: {
		backgroundColor: color.warningWashStrong,
		borderColor: color.warningBorderSoft,
		color: color.warningText,
	},
	success: {
		backgroundColor: color.successWash,
		borderColor: color.successBorderSoft,
		color: color.successText,
	},
	info: {
		backgroundColor: color.infoWash,
		borderColor: color.infoBorder,
		color: color.infoText,
	},
	noticeIcon: {
		flexShrink: 0,
		marginTop: "0.125rem",
	},
	noticeContent: {
		minWidth: controlSize._0,
		overflowWrap: "break-word",
	},
});
