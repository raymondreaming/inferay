import * as stylex from "@stylexjs/stylex";
import { color, font } from "../../../design-system/styles.stylex.ts";
export const styles = stylex.create({
	fallback: {
		alignItems: "center",
		backgroundColor: color.background,
		display: "flex",
		flexDirection: "column",
		gap: 12,
		height: "100vh",
		justifyContent: "center",
	},
	contained: {
		height: "100%",
		minHeight: 120,
		padding: 16,
	},
	message: {
		color: color.textSoft,
		fontSize: font.size_3,
	},
});
