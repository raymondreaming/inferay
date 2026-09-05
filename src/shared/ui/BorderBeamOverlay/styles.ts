import * as stylex from "@octanejs/stylex";
import { controlSize } from "../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	host: {
		inset: controlSize._0,
		pointerEvents: "none",
		position: "absolute",
		zIndex: 3,
	},
});
