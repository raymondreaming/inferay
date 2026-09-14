import * as stylex from "@stylexjs/stylex";
import {
	breakpoint,
	color,
	controlSize,
} from "../../../../design-system/styles.stylex.ts";
export const styles = stylex.create({
	mcpName: { display: "flex", alignItems: "center", gap: "10px", minWidth: 0 },
	mcpIcon: {
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		width: "28px",
		height: "28px",
		flexShrink: 0,
		borderRadius: "7px",
		backgroundColor: color.surfaceControl,
		fontSize: "11px",
	},
	mcpImage: { width: "22px", height: "22px", objectFit: "contain" },
	mcpActions: {
		display: "flex",
		alignItems: "center",
		justifyContent: "flex-end",
		flexWrap: "wrap",
		gap: "6px",
	},
	banner: {
		paddingBlockEnd: controlSize._3,
	},
	control: {
		minWidth: {
			default: controlSize._0,
			[breakpoint.tablet]: "11rem",
		},
	},
	cloneDirectory: {
		width: {
			default: "8rem",
			[breakpoint.tablet]: "13rem",
		},
	},
	search: {
		width: {
			default: "9rem",
			[breakpoint.tablet]: "15rem",
		},
	},
	noShrink: {
		flexShrink: 0,
	},
	repoList: {
		display: "flex",
		flexDirection: "column",
		maxHeight: "20rem",
		overflowY: "auto",
		overscrollBehavior: "contain",
	},
	providerStatus: {
		color: color.textMuted,
	},
});
