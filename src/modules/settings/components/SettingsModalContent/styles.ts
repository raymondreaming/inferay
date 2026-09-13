import * as stylex from "@stylexjs/stylex";
import {
	breakpoint,
	color,
	controlSize,
	font,
	radius,
} from "../../../../design-system/styles.stylex.ts";
export const styles = stylex.create({
	banner: {
		paddingBlockEnd: controlSize._3,
	},
	control: {
		backgroundColor: color.surfaceWhite04,
		borderColor: color.border,
		borderRadius: radius.lg,
		backgroundImage: "none",
		boxShadow: "none",
		fontSize: font.size_2,
		height: controlSize._8,
		minWidth: {
			default: controlSize._0,
			[breakpoint.tablet]: "11rem",
		},
	},
	cloneDirectory: {
		backgroundColor: color.surfaceWhite04,
		borderRadius: radius.lg,
		width: {
			default: "8rem",
			[breakpoint.tablet]: "13rem",
		},
	},
	search: {
		backgroundColor: color.surfaceWhite04,
		borderRadius: radius.lg,
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
