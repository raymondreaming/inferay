import * as stylex from "@stylexjs/stylex";
import { color, controlSize } from "../../../../design-system/styles.stylex.ts";
export const styles = stylex.create({
	sidebarShell: {
		containerType: "inline-size",
		containerName: "changes",
		position: "relative",
		display: "flex",
		height: "100%",
		minHeight: controlSize._0,
		width: "100%",
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: color.border,
		backgroundColor: color.transparent,
	},
	diffRail: {
		position: "relative",
		boxSizing: "border-box",
		display: "flex",
		minWidth: controlSize._0,
		height: "100%",
		minHeight: controlSize._0,
		flex: 1,
		backgroundColor: color.transparent,
		overflow: "visible",
	},
});
