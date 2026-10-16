import * as stylex from "@stylexjs/stylex";
export const styles = stylex.create({
	surface: {
		display: "flex",
		height: "100%",
		minWidth: 0,
		minHeight: 0,
		overflow: "hidden",
	},
	inactive: { display: "none" },
});
