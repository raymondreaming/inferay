import * as stylex from "@stylexjs/stylex";
export const styles = stylex.create({
	root: {
		display: "flex",
		flexDirection: "column",
		height: "100%",
		minHeight: 0,
		minWidth: 0,
	},
	surface: {
		display: "flex",
		flex: 1,
		minWidth: 0,
		minHeight: 0,
		overflow: "hidden",
	},
	inactive: { display: "none" },
});
