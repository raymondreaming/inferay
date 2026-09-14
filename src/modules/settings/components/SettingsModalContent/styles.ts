import * as stylex from "@stylexjs/stylex";
import {
	breakpoint,
	color,
	controlSize,
	font,
	radius,
} from "../../../../design-system/styles.stylex.ts";
export const styles = stylex.create({
	mcpGrid: {
		display: "grid",
		gridTemplateColumns: {
			default: "minmax(0, 1fr)",
			[breakpoint.tablet]: "repeat(2, minmax(0, 1fr))",
		},
		gap: controlSize._6,
		alignItems: "start",
	},
	mcpCard: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		padding: controlSize._3,
		marginBlockStart: controlSize._2,
		minWidth: 0,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.borderSubtle,
		borderRadius: radius.lg,
		backgroundColor: color.surfaceControl,
	},
	mcpIdentity: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._0_5,
		minWidth: 0,
	},
	mcpLabel: {
		fontSize: font.size_3,
		fontWeight: font.weight_5,
		color: color.textSoft,
		overflowWrap: "anywhere",
	},
	mcpStatus: { fontSize: font.size_1, color: color.textMuted },
	mcpConnected: { color: color.success },
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
