import * as stylex from "@stylexjs/stylex";

export const styles = stylex.create({
	panel: {
		display: "flex",
		flexDirection: "column",
		width: "100%",
		alignSelf: "stretch",
		flexGrow: 1,
		minWidth: 0,
		height: "100%",
		minHeight: 0,
	},
});
