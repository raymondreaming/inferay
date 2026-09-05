import * as stylex from "@octanejs/stylex";
import { controlSize } from "../../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	root: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		height: "100%",
		width: "100%",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		overflow: "hidden",
		position: "relative",
	},
	agentPane: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		width: "100%",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		overflow: "hidden",
		position: "relative",
	},
});
