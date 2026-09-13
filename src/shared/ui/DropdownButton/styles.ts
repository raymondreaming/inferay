import * as stylex from "@stylexjs/stylex";
import {
	color,
	controlSize,
	font,
	layer,
	motion,
	radius,
	shadow,
} from "../../../design-system/styles.stylex.ts";
import type { CSSProperties } from "../../lib/dom.tsx";
export const styles = stylex.create({
	button: {
		alignItems: "center",
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.none,
		display: "flex",
		fontSize: font.size_3,
		fontWeight: font.weight_5,
		gap: controlSize._2,
		height: controlSize._7,
		paddingInline: controlSize._2_5,
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, border-color, color",
		transitionTimingFunction: motion.ease,
		userSelect: "none",
	},
	buttonLabel: {
		fontSize: font.size_2,
		transitionProperty: "color",
		transitionDuration: motion.durationBase,
	},
	buttonLabelFull: {
		flex: 1,
		overflow: "hidden",
		textAlign: "left",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	buttonLabelSelected: {
		color: color.textMain,
	},
	buttonLabelMuted: {
		color: color.textMuted,
	},
	chevron: {
		color: color.textMuted,
		flexShrink: 0,
		transitionDuration: motion.durationBase,
		transitionProperty: "transform",
		transitionTimingFunction: "ease",
	},
	chevronOpen: {
		transform: "rotate(180deg)",
	},
	buttonClosed: {
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlActive,
		},
		backgroundImage: "none",
		borderColor: {
			default: color.border,
			":hover": color.borderStrong,
		},
		color: color.textSoft,
	},
	buttonOpen: {
		backgroundColor: color.controlActive,
		backgroundImage: "none",
		borderColor: color.borderStrong,
		color: color.textMain,
	},
	fullWidth: {
		width: "100%",
	},
	menu: {
		backgroundColor: color.popoverOpaque,
		backgroundImage: "none",
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.popover,
		overflow: "hidden",
		position: "fixed",
		userSelect: "none",
		zIndex: layer.dropdownPopover,
	},
	menuLiquid: {
		backdropFilter: "none",
		backgroundColor: color.transparent,
		backgroundImage: "none",
		borderColor: color.transparent,
		boxShadow: "none",
	},
	searchWrap: {
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._1_5,
	},
	searchInput: {
		userSelect: "text",
	},
	optionsBox: {
		overflowY: "auto",
		scrollbarWidth: "none",
		"::-webkit-scrollbar": {
			display: "none",
		},
	},
	empty: {
		color: color.textMuted,
		fontSize: font.size_2,
		paddingBlock: controlSize._3,
		paddingInline: controlSize._3,
		textAlign: "center",
	},
	customOption: {
		cursor: "pointer",
		display: "block",
		width: "100%",
	},
	option: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		backgroundImage: "none",
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		display: "flex",
		fontSize: font.size_2,
		gap: controlSize._2,
		minHeight: 26,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		textAlign: "left",
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, color",
		transitionTimingFunction: "ease",
		userSelect: "none",
		width: "100%",
	},
	optionIcon: {
		color: color.textMuted,
		flexShrink: 0,
	},
	optionContent: {
		minWidth: controlSize._0,
	},
	optionLabel: {
		display: "block",
		fontWeight: font.weight_5,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	detailBadge: {
		backgroundColor: color.surfaceWhite06,
		borderRadius: radius.sm,
		color: color.textMuted,
		fontSize: font.size_0_5,
		fontWeight: font.weight_5,
		marginLeft: controlSize._1_5,
		paddingBlock: "0.125rem",
		paddingInline: controlSize._1,
	},
	detailBadgeFeatured: {
		backgroundColor: color.surfaceWhite08,
		color: color.textSoft,
	},
	optionStatus: {
		color: color.textMuted,
		fontSize: font.size_1,
		marginLeft: controlSize._1_5,
	},
	optionSelected: {
		backgroundColor: color.controlActive,
		backgroundImage: "none",
		color: color.textMain,
	},
	topSearchDivider: {
		borderTopColor: color.border,
		borderTopStyle: "solid",
		borderTopWidth: 1,
	},
});
export function getDropdownButtonOptionsBoxStyle(
	maxHeight: CSSProperties["maxHeight"],
): CSSProperties {
	return {
		maxHeight: maxHeight,
	} as CSSProperties;
}
export function getDropdownButtonMenuStyle(
	top: CSSProperties["top"],
	bottom: CSSProperties["bottom"],
	left: CSSProperties["left"],
	minWidth: CSSProperties["minWidth"],
	maxHeight: CSSProperties["maxHeight"],
): CSSProperties {
	return {
		top: top,
		bottom: bottom,
		left: left,
		minWidth: minWidth,
		maxHeight: maxHeight,
	} as CSSProperties;
}
