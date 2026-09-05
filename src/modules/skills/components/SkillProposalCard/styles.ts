import * as stylex from "@octanejs/stylex";
import {
	color,
	controlSize,
	font,
	radius,
} from "../../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	card: {
		marginBlock: controlSize._3,
		padding: controlSize._4,
		fontSize: font.size_2,
		color: color.textSoft,
	},
	heading: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: controlSize._2,
		color: color.textMain,
	},
	reason: { color: color.textMuted, marginBlock: controlSize._2 },
	instructions: {
		whiteSpace: "pre-wrap",
		overflowWrap: "anywhere",
		maxHeight: "320px",
		overflowY: "auto",
		backgroundColor: color.background,
		padding: controlSize._3,
		borderRadius: radius.md,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
	},
	actions: { display: "flex", gap: controlSize._2, marginTop: controlSize._3 },
	button: {
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._3,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		":disabled": { opacity: 0.5 },
	},
	approve: { backgroundColor: color.controlActive, color: color.textMain },
});
