import * as stylex from "@octanejs/stylex";
import type { CSSProperties } from "react";
import {
	color,
	controlSize,
	effect,
	font,
	layer,
	motion,
	radius,
	shadow,
} from "../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	button: {
		alignItems: "center",
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: "var(--dropdown-button-border-width, 1px)",
		display: "flex",
		fontSize: font.size_3,
		gap: controlSize._2,
		height: controlSize._7,
		paddingInline: controlSize._3,
		boxShadow: `var(--dropdown-button-shadow, ${shadow.controlDepth})`,
		transitionDuration: motion.durationBase,
		transitionProperty:
			"background-color, background-image, border-color, box-shadow, color",
		transitionTimingFunction: "ease",
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
			default: `var(--dropdown-button-bg-color, ${color.backgroundRaised})`,
			":hover": `var(--dropdown-button-hover-bg-color, var(--dropdown-button-bg-color, ${color.controlHover}))`,
		},
		backgroundImage: {
			default: `var(--dropdown-button-bg-image, ${effect.controlDepth})`,
			":hover": `var(--dropdown-button-hover-bg-image, var(--dropdown-button-bg-image, ${effect.controlDepthHover}))`,
		},
		borderColor: `var(--dropdown-button-border-color, ${color.border})`,
		color: `var(--dropdown-button-color, ${color.textSoft})`,
		boxShadow: {
			default: `var(--dropdown-button-shadow, ${shadow.controlDepth})`,
			":hover": `var(--dropdown-button-hover-shadow, var(--dropdown-button-shadow, ${shadow.controlDepthHover}))`,
		},
	},
	buttonOpen: {
		backgroundColor: `var(--dropdown-button-open-bg-color, var(--dropdown-button-bg-color, ${color.controlActive}))`,
		backgroundImage: `var(--dropdown-button-open-bg-image, var(--dropdown-button-bg-image, ${effect.controlDepthHover}))`,
		borderColor: `var(--dropdown-button-open-border-color, var(--dropdown-button-border-color, ${color.borderStrong}))`,
		boxShadow: `var(--dropdown-button-open-shadow, var(--dropdown-button-shadow, ${shadow.controlDepthHover}))`,
		color: `var(--dropdown-button-open-color, var(--dropdown-button-color, ${color.textMain}))`,
	},
	fullWidth: {
		width: "100%",
	},
	menu: {
		backdropFilter: "blur(24px)",
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.popoverDepth,
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
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
	},
	searchInput: {
		backgroundColor: color.surfaceControl,
		backgroundImage: effect.controlDepth,
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMain,
		fontSize: font.size_2,
		outline: "none",
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		width: "100%",
		userSelect: "text",
		"::placeholder": {
			color: color.textMuted,
		},
		":focus": {
			borderColor: color.accentBorder,
			boxShadow: shadow.focusRing,
		},
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
		backgroundImage: {
			default: "none",
			":hover": effect.controlDepth,
		},
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
		backgroundImage:
			"linear-gradient(90deg, rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.018))",
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
	return { maxHeight: maxHeight } as CSSProperties;
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
