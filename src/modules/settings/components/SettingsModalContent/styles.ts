import * as stylex from "@stylexjs/stylex";
import {
	breakpoint,
	color,
	controlSize,
} from "../../../../design-system/styles.stylex.ts";
export const styles = stylex.create({
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
