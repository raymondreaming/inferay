import * as stylex from "@stylexjs/stylex";
export const styles = stylex.create({
	panel: {
		position: "fixed",
		right: 12,
		bottom: 12,
		zIndex: 2147483647,
		width: 380,
		maxHeight: "70vh",
		overflow: "auto",
		padding: 16,
		backgroundColor: "#17191d",
		color: "#f3f4f6",
		borderRadius: 8,
		border: "1px solid #51555e",
		fontSize: 12,
		lineHeight: 1.5,
		display: "flex",
		flexDirection: "column",
		gap: 8,
	},
});
