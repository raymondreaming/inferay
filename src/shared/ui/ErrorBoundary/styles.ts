import * as stylex from "@octanejs/stylex";
import { color, font } from "../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	fallback: {
		alignItems: "center",
		backgroundColor: color.background,
		display: "flex",
		height: "100vh",
		justifyContent: "center",
	},
	message: {
		color: color.textSoft,
		fontSize: font.size_3,
	},
});
