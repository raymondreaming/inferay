import * as stylex from "@stylexjs/stylex";

/**
 * Inferay's typed styling interface: tokens, shared appearances, and runtime values.
 * Theme colors and surface formulas live in styles.css. Import this file directly.
 */

export const palette = stylex.defineVars({
	white: stylex.types.color("#ffffff"),
});
export const color = stylex.defineVars({
	transparent: stylex.types.color("transparent"),
	background: "var(--inferay-surface-base)",
	backgroundRaised: "var(--inferay-surface-raised)",
	backgroundPanel: "var(--inferay-surface-panel)",
	backgroundCanvas: "var(--inferay-surface-canvas)",
	backgroundOverlay: stylex.types.color("rgba(0, 0, 0, 0.6)"),
	shellSurface: stylex.types.color("transparent"),
	surfaceGlassStrong: "var(--inferay-surface-glass-strong)",
	surfaceInset:
		"color-mix(in srgb, var(--color-inferay-gray) 34%, transparent)",
	surfaceSubtle:
		"color-mix(in srgb, var(--color-inferay-gray) 34%, transparent)",
	surfaceControl: "var(--inferay-surface-control)",
	surfaceControlHover: "var(--inferay-surface-control-hover)",
	surfaceWhite02: stylex.types.color("rgba(255, 255, 255, 0.02)"),
	surfaceWhite025: stylex.types.color("rgba(255, 255, 255, 0.025)"),
	surfaceWhite04: stylex.types.color("rgba(255, 255, 255, 0.04)"),
	surfaceWhite05: stylex.types.color("rgba(255, 255, 255, 0.05)"),
	surfaceWhite06: stylex.types.color("rgba(255, 255, 255, 0.06)"),
	surfaceWhite08: stylex.types.color("rgba(255, 255, 255, 0.08)"),
	surfaceWhite10: stylex.types.color("rgba(255, 255, 255, 0.1)"),
	surfaceWhite14: stylex.types.color("rgba(255, 255, 255, 0.14)"),
	surfaceWhite25: stylex.types.color("rgba(255, 255, 255, 0.25)"),
	surfaceWhite40: stylex.types.color("rgba(255, 255, 255, 0.4)"),
	surfaceBlack70: stylex.types.color("rgba(0, 0, 0, 0.7)"),
	border: "var(--color-inferay-gray-border)",
	borderSubtle:
		"color-mix(in srgb, var(--color-inferay-gray-border) 48%, transparent)",
	borderStrong: "var(--color-inferay-gray-border-bold)",
	focusRing: "color-mix(in srgb, var(--color-inferay-info) 58%, transparent)",
	controlHover: "var(--color-inferay-gray)",
	controlActive:
		"color-mix(in srgb, var(--color-inferay-gray) 82%, var(--color-inferay-light-gray) 18%)",
	textMain: "var(--color-inferay-white)",
	textSoft: "var(--color-inferay-soft-white)",
	textMuted: "var(--color-inferay-muted-gray)",
	textFaint: stylex.types.color("rgba(255, 255, 255, 0.3)"),
	textWarmWhite: stylex.types.color("#f4f4f2"),
	textWarmInk: stylex.types.color("#111210"),
	accent: "var(--color-inferay-accent)",
	accentHover: "var(--color-inferay-accent-hover)",
	accentForeground: "var(--color-inferay-accent-foreground)",
	accentWash:
		"color-mix(in srgb, var(--color-inferay-gray) 86%, var(--color-inferay-light-gray) 14%)",
	accentBorder:
		"color-mix(in srgb, var(--color-inferay-gray-border-bold) 72%, var(--color-inferay-light-gray) 28%)",
	danger: "var(--color-inferay-error)",
	dangerHover: stylex.types.color("rgba(239, 68, 68, 0.2)"),
	dangerWash: stylex.types.color("rgba(239, 68, 68, 0.15)"),
	dangerBorder: stylex.types.color("rgba(239, 68, 68, 0.2)"),
	success: "var(--color-inferay-success)",
	successWash: stylex.types.color("rgba(16, 185, 129, 0.1)"),
	successBorder: stylex.types.color("rgba(16, 185, 129, 0.4)"),
	warning: "var(--color-inferay-warning)",
	warningWash: stylex.types.color("rgba(245, 158, 11, 0.1)"),
	warningBorder: stylex.types.color("rgba(245, 158, 11, 0.4)"),
	warningWashStrong: stylex.types.color("rgba(245, 158, 11, 0.08)"),
	warningBorderSoft: stylex.types.color("rgba(245, 158, 11, 0.25)"),
	warningText: stylex.types.color("#fde68a"),
	successBorderSoft: stylex.types.color("rgba(16, 185, 129, 0.25)"),
	successText: stylex.types.color("#a7f3d0"),
	infoWash: stylex.types.color("rgba(100, 210, 255, 0.08)"),
	infoBorder: stylex.types.color("rgba(100, 210, 255, 0.25)"),
	infoText: stylex.types.color("#bae6fd"),
	reviewHighlight: stylex.types.color("rgba(244, 221, 181, 0.58)"),
	gitAdded: "var(--color-git-added)",
	gitDeleted: "var(--color-git-deleted)",
	diffAdded: stylex.types.color("#32e875"),
	diffRemoved: stylex.types.color("#ff5252"),
});
export const controlSize = stylex.defineVars({
	_0: stylex.types.length("0px"),
	_0_25: stylex.types.length("0.0625rem"),
	_0_5: stylex.types.length("0.125rem"),
	_1: stylex.types.length("0.25rem"),
	_1_25: stylex.types.length("0.3125rem"),
	_1_5: stylex.types.length("0.375rem"),
	_2: stylex.types.length("0.5rem"),
	_2_5: stylex.types.length("0.625rem"),
	_3: stylex.types.length("0.75rem"),
	_3_5: stylex.types.length("0.875rem"),
	_4: stylex.types.length("1rem"),
	_5: stylex.types.length("1.25rem"),
	_6: stylex.types.length("1.5rem"),
	_7: stylex.types.length("1.75rem"),
	_8: stylex.types.length("2rem"),
	_9: stylex.types.length("2.25rem"),
	_10: stylex.types.length("2.5rem"),
	_12: stylex.types.length("3rem"),
	_16: stylex.types.length("4rem"),
});
// A 600px chat column with 12px gutters on either side.
export const layoutSize = stylex.defineVars({
	chatColumn: stylex.types.length("624px"),
});
export const font = stylex.defineVars({
	familySans: "var(--font-sans)",
	familyMono: "var(--font-mono)",
	familyDiff: "var(--font-diff)",
	size_0: stylex.types.length("0.4375rem"),
	size_0_5: stylex.types.length("0.5rem"),
	size_1: stylex.types.length("0.5625rem"),
	size_2: stylex.types.length("0.625rem"),
	size_2_75: stylex.types.length("0.6875rem"),
	size_3: stylex.types.length("0.75rem"),
	size_4: stylex.types.length("0.8125rem"),
	size_5: stylex.types.length("0.875rem"),
	size_5_5: stylex.types.length("0.9375rem"),
	size_7: stylex.types.length("1.125rem"),
	weightRegular: stylex.types.number(400),
	weight_5: stylex.types.number(500),
	weight_6: stylex.types.number(600),
	weightBold: stylex.types.number(700),
});
export const radius = stylex.defineVars({
	none: stylex.types.length("0px"),
	px1: stylex.types.length("1px"),
	xs: stylex.types.length("0.125rem"),
	sm: stylex.types.length("0.25rem"),
	md: stylex.types.length("0.375rem"),
	lg: stylex.types.length("0.5rem"),
	xl: stylex.types.length("0.75rem"),
	_2xl: stylex.types.length("1rem"),
	circle: stylex.types.lengthPercentage("50%"),
	pill: stylex.types.length("999px"),
});
export const motion = stylex.defineVars({
	durationInstant: stylex.types.time("0ms"),
	durationFast: stylex.types.time("120ms"),
	durationBase: stylex.types.time("150ms"),
	durationSlow: stylex.types.time("200ms"),
	durationDeliberate: stylex.types.time("240ms"),
	durationLonger: stylex.types.time("800ms"),
	ease: "ease",
	easeStandard: "cubic-bezier(0.2, 0, 0, 1)",
});
export const shadow = stylex.defineVars({
	none: "none",
	controlDepth: "var(--shadow-inferay-control-depth)",
	controlDepthHover: "var(--shadow-inferay-control-depth-hover)",
	composerFrame: "var(--shadow-inferay-composer-frame)",
	composerFrameFocus: "var(--shadow-inferay-composer-frame-focus)",
	focusRing: "var(--shadow-inferay-focus-ring)",
	popover: "var(--shadow-inferay-popover)",
});
export const effect = stylex.defineVars({
	floatingSurfaceBlur: "var(--inferay-overlay-blur, none)",
	controlDepth: "var(--effect-inferay-control-depth)",
	controlDepthHover: "var(--effect-inferay-control-depth-hover)",
	tokenHighlightBackground:
		"color-mix(in srgb, var(--color-inferay-accent) 15%, transparent)",
});
export const layer = stylex.defineConsts({
	base: "0",
	content: "1",
	chrome: "2",
	overlayContent: "3",
	control: "10",
	dropdown: "20",
	sticky: "30",
	popover: "40",
	modal: "50",
	workspaceOverlay: "100",
	workspaceDrag: "110",
	titlebar: "120",
	navigationPopover: "200",
	searchPopover: "360",
	dropdownPopover: "320",
	criticalOverlay: "9999",
});
export const breakpoint = stylex.defineConsts({
	tablet: "@media (min-width: 640px)",
});
export const iconSize = {
	micro: 7,
	xs: 8,
	sm: 10,
	compact: 11,
	md: 12,
	_2md: 13,
	lg: 14,
	_2lg: 15,
	xl: 16,
	_2xl: 18,
} as const;
export const runtimeColor = {
	textMain: "var(--color-inferay-white)",
} as const;

/** Stable high-contrast lane palette for SVG/canvas Git topology rendering. */
export const runtimeGitGraphLaneColors = [
	"#1c97b5",
	"#0063f2",
	"#7f12b7",
	"#ba18ab",
	"#d00066",
	"#c40012",
	"#ed4e2f",
	"#f0c13a",
	"#76d33c",
	"#36c894",
] as const;
export const surfaceStyles = stylex.create({
	errorNotice: {
		alignItems: "center",
		backgroundColor: color.dangerWash,
		color: color.textMain,
		display: "flex",
		flexShrink: 0,
		flexWrap: "wrap",
		fontSize: font.size_2,
		gap: 8,
		padding: 12,
	},
	errorMessage: {
		flex: "1 1 180px",
		minWidth: 0,
		overflowWrap: "anywhere",
	},
	/** The one treatment for every floating layer: modals, dialogs, menus, popovers. */
	overlay: {
		backdropFilter: effect.floatingSurfaceBlur,
		backgroundColor: color.backgroundPanel,
		backgroundImage: "none",
		borderColor: color.border,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.popover,
	},
	panel: {
		backgroundColor: color.backgroundPanel,
		borderColor: color.border,
		borderStyle: "solid",
		borderWidth: 1,
		borderRadius: radius.xl,
	},
	/** The one hover treatment for rows: explorer entries, menu items, pick lists. */
});
type SelectionVariant =
	"sidebar" | "repository" | "view" | "list" | "navigation";

/** Owns selection appearance. Callers supply layout, labels, and behavior only. */
export function selectionAppearance(
	variant: SelectionVariant,
	selected: boolean,
) {
	const bordered = variant === "sidebar" || variant === "list";
	return [
		selection.base,
		selection[variant],
		bordered && selection.bordered,
		selected && selection.selected,
		selected && bordered && selection.selectedBorder,
		selected && variant === "navigation" && selection.navigationSelected,
	];
}
const selection = stylex.create({
	navigation: {
		borderRadius: radius.md,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
	},
	navigationSelected: {
		backgroundColor: color.controlActive,
		boxShadow: "none",
	},
	base: {
		backgroundColor: color.transparent,
		backgroundImage: "none",
		borderColor: color.transparent,
		borderStyle: "solid",
		borderWidth: 0,
		boxShadow: "none",
		boxSizing: "border-box",
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, border-color, color",
		transitionTimingFunction: motion.ease,
	},
	sidebar: {
		borderRadius: radius.md,
	},
	repository: {
		borderRadius: radius.none,
	},
	view: {
		borderRadius: radius.sm,
	},
	list: {
		borderRadius: radius.md,
		backgroundColor: {
			default: color.transparent,
			":hover": color.backgroundPanel,
		},
		borderColor: {
			default: color.transparent,
			":hover": color.border,
		},
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
	},
	bordered: {
		borderWidth: 1,
	},
	selected: {
		backgroundColor:
			"var(--inferay-selection-fill, var(--inferay-surface-panel))",
		boxShadow: "var(--inferay-selection-outline, none)",
		color: color.textMain,
	},
	selectedBorder: {
		boxShadow: "none",
		borderColor:
			"var(--inferay-selection-border, var(--color-inferay-gray-border))",
	},
});
