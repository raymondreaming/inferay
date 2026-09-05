import * as stylex from "@octanejs/stylex";
import {
	color,
	controlSize,
	font,
	radius,
} from "../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	emptyState: {
		alignItems: "center",
		color: color.textMuted,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		height: "100%",
		justifyContent: "center",
		minHeight: controlSize._16,
		padding: controlSize._4,
		textAlign: "center",
	},
	emptyIcon: {
		alignItems: "center",
		backgroundColor: color.background,
		borderColor: color.border,
		borderRadius: radius.sm,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		display: "inline-flex",
		height: controlSize._9,
		justifyContent: "center",
		width: controlSize._9,
	},
	emptyText: {
		alignItems: "center",
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		maxWidth: "28rem",
	},
	emptyTitle: {
		color: color.textSoft,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
	},
	emptyDescription: {
		color: color.textMuted,
		fontSize: font.size_2,
		lineHeight: 1.5,
	},
	emptyAction: {
		display: "flex",
		justifyContent: "center",
		marginTop: controlSize._1,
	},
});
