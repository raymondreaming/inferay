import * as stylex from "@octanejs/stylex";

/**
 * Inferay's typed styling interface: tokens, shared appearances, and runtime values.
 * Theme colors and surface formulas live in styles.css. Import this file directly.
 */

export const palette = stylex.defineVars({
	transparent: stylex.types.color("transparent"),
	black: stylex.types.color("#000000"),
	white: stylex.types.color("#ffffff"),
	canvas: stylex.types.color("#050506"),
	green: stylex.types.color("#32e875"),
	red: stylex.types.color("#ff5252"),
	yellow: stylex.types.color("#ffd23f"),
	blue: stylex.types.color("#74a7ff"),
	emerald: stylex.types.color("#10b981"),
	purple: stylex.types.color("#a855f7"),
	pink: stylex.types.color("#ec4899"),
	amber: stylex.types.color("#f59e0b"),
	orange: stylex.types.color("#f97316"),
	cyan: stylex.types.color("#06b6d4"),
	emerald80: stylex.types.color("rgba(16, 185, 129, 0.8)"),
	emerald60: stylex.types.color("rgba(16, 185, 129, 0.6)"),
	emerald40: stylex.types.color("rgba(16, 185, 129, 0.4)"),
	purple80: stylex.types.color("rgba(168, 85, 247, 0.8)"),
	purple40: stylex.types.color("rgba(168, 85, 247, 0.4)"),
	pink80: stylex.types.color("rgba(236, 72, 153, 0.8)"),
	pink40: stylex.types.color("rgba(236, 72, 153, 0.4)"),
	amber80: stylex.types.color("rgba(245, 158, 11, 0.8)"),
	amber40: stylex.types.color("rgba(245, 158, 11, 0.4)"),
	orange80: stylex.types.color("rgba(249, 115, 22, 0.8)"),
	orange70: stylex.types.color("rgba(249, 115, 22, 0.7)"),
	orange40: stylex.types.color("rgba(249, 115, 22, 0.4)"),
	cyan80: stylex.types.color("rgba(6, 182, 212, 0.8)"),
	cyan40: stylex.types.color("rgba(6, 182, 212, 0.4)"),
	danger60: stylex.types.color("rgba(239, 68, 68, 0.6)"),
});

export const color = stylex.defineVars({
	transparent: stylex.types.color("transparent"),
	background: stylex.types.color("var(--inferay-surface-base)"),
	backgroundRaised: stylex.types.color("var(--inferay-surface-raised)"),
	backgroundSubtle: stylex.types.color("var(--inferay-surface-subtle)"),
	backgroundPanel: stylex.types.color("var(--inferay-surface-panel)"),
	backgroundModal: stylex.types.color("var(--inferay-surface-modal)"),
	backgroundCanvas: stylex.types.color("var(--inferay-surface-canvas)"),
	backgroundOverlay: stylex.types.color("rgba(0, 0, 0, 0.6)"),
	backgroundOverlayStrong: stylex.types.color("rgba(0, 0, 0, 0.95)"),
	shellFrame: stylex.types.color("var(--color-inferay-gray-border)"),
	shellSurface: stylex.types.color("transparent"),
	surfaceTranslucent: stylex.types.color(
		"color-mix(in srgb, var(--color-inferay-dark-gray) 72%, transparent)",
	),
	surfaceGlass: stylex.types.color(
		"color-mix(in srgb, var(--color-inferay-dark-gray) 78%, transparent)",
	),
	surfaceGlassStrong: stylex.types.color("var(--inferay-surface-glass-strong)"),
	surfaceInset: stylex.types.color(
		"color-mix(in srgb, var(--color-inferay-gray) 34%, transparent)",
	),
	surfaceSubtle: stylex.types.color(
		"color-mix(in srgb, var(--color-inferay-gray) 34%, transparent)",
	),
	surfaceControl: stylex.types.color("var(--inferay-surface-control)"),
	surfaceControlHover: stylex.types.color(
		"var(--inferay-surface-control-hover)",
	),
	surfaceWhite01: stylex.types.color("rgba(255, 255, 255, 0.01)"),
	surfaceWhite02: stylex.types.color("rgba(255, 255, 255, 0.02)"),
	surfaceWhite025: stylex.types.color("rgba(255, 255, 255, 0.025)"),
	surfaceWhite04: stylex.types.color("rgba(255, 255, 255, 0.04)"),
	surfaceWhite05: stylex.types.color("rgba(255, 255, 255, 0.05)"),
	surfaceWhite06: stylex.types.color("rgba(255, 255, 255, 0.06)"),
	surfaceWhite075: stylex.types.color("rgba(255, 255, 255, 0.075)"),
	surfaceWhite08: stylex.types.color("rgba(255, 255, 255, 0.08)"),
	surfaceWhite10: stylex.types.color("rgba(255, 255, 255, 0.1)"),
	surfaceWhite12: stylex.types.color("rgba(255, 255, 255, 0.12)"),
	surfaceWhite13: stylex.types.color("rgba(255, 255, 255, 0.13)"),
	surfaceWhite14: stylex.types.color("rgba(255, 255, 255, 0.14)"),
	surfaceWhite15: stylex.types.color("rgba(255, 255, 255, 0.15)"),
	surfaceWhite18: stylex.types.color("rgba(255, 255, 255, 0.18)"),
	surfaceWhite22: stylex.types.color("rgba(255, 255, 255, 0.22)"),
	surfaceWhite25: stylex.types.color("rgba(255, 255, 255, 0.25)"),
	surfaceWhite40: stylex.types.color("rgba(255, 255, 255, 0.4)"),
	surfaceWhite80: stylex.types.color("rgba(255, 255, 255, 0.8)"),
	surfaceBlack14: stylex.types.color("rgba(0, 0, 0, 0.14)"),
	surfaceBlack70: stylex.types.color("rgba(0, 0, 0, 0.7)"),
	border: stylex.types.color("var(--color-inferay-gray-border)"),
	borderSubtle: stylex.types.color(
		"color-mix(in srgb, var(--color-inferay-gray-border) 48%, transparent)",
	),
	borderStrong: stylex.types.color("var(--color-inferay-gray-border-bold)"),
	borderControl: stylex.types.color("var(--color-inferay-gray-border-bold)"),
	focusRing: stylex.types.color(
		"color-mix(in srgb, var(--color-inferay-info) 58%, transparent)",
	),
	controlHover: stylex.types.color("var(--color-inferay-gray)"),
	controlActive: stylex.types.color(
		"color-mix(in srgb, var(--color-inferay-gray) 82%, var(--color-inferay-light-gray) 18%)",
	),
	textMain: stylex.types.color("var(--color-inferay-white)"),
	textSoft: stylex.types.color("var(--color-inferay-soft-white)"),
	textMuted: stylex.types.color("var(--color-inferay-muted-gray)"),
	textFaint: stylex.types.color("rgba(255, 255, 255, 0.3)"),
	textInverse: stylex.types.color("#000000"),
	textPure: stylex.types.color("#ffffff"),
	textWarmWhite: stylex.types.color("#f4f4f2"),
	textWarmInk: stylex.types.color("#111210"),
	textWarmInkSoft: stylex.types.color("#292a27"),
	accent: stylex.types.color("var(--color-inferay-accent)"),
	accentHover: stylex.types.color("var(--color-inferay-accent-hover)"),
	accentForeground: stylex.types.color(
		"var(--color-inferay-accent-foreground)",
	),
	accentWash: stylex.types.color(
		"color-mix(in srgb, var(--color-inferay-gray) 86%, var(--color-inferay-light-gray) 14%)",
	),
	accentBorder: stylex.types.color(
		"color-mix(in srgb, var(--color-inferay-gray-border-bold) 72%, var(--color-inferay-light-gray) 28%)",
	),
	danger: stylex.types.color("var(--color-inferay-error)"),
	dangerHover: stylex.types.color("rgba(239, 68, 68, 0.2)"),
	dangerWash: stylex.types.color("rgba(239, 68, 68, 0.15)"),
	dangerBorder: stylex.types.color("rgba(239, 68, 68, 0.2)"),
	success: stylex.types.color("var(--color-inferay-success)"),
	successWash: stylex.types.color("rgba(16, 185, 129, 0.1)"),
	successBorder: stylex.types.color("rgba(16, 185, 129, 0.4)"),
	warning: stylex.types.color("var(--color-inferay-warning)"),
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
	popoverOpaque: stylex.types.color(
		"color-mix(in srgb, var(--color-inferay-dark-gray) 96%, transparent)",
	),
	headerPopoverOpaque: stylex.types.color(
		"color-mix(in srgb, var(--color-inferay-dark-gray) 98%, transparent)",
	),
	gitAdded: stylex.types.color("var(--color-git-added)"),
	gitModified: stylex.types.color("var(--color-git-modified)"),
	gitDeleted: stylex.types.color("var(--color-git-deleted)"),
	gitRenamed: stylex.types.color("var(--color-git-renamed)"),
	gitUnmerged: stylex.types.color("var(--color-git-unmerged)"),
	diffAdded: stylex.types.color("#32e875"),
	diffRemoved: stylex.types.color("#ff5252"),
	diffModified: stylex.types.color("#ffd23f"),
	diffRenamed: stylex.types.color("#74a7ff"),
});

export const controlSize = stylex.defineVars({
	_0: stylex.types.length("0px"),
	_0_25: stylex.types.length("0.0625rem"),
	_0_5: stylex.types.length("0.125rem"),
	_0_75: stylex.types.length("0.1875rem"),
	_1: stylex.types.length("0.25rem"),
	_1_25: stylex.types.length("0.3125rem"),
	_1_5: stylex.types.length("0.375rem"),
	_1_75: stylex.types.length("0.4375rem"),
	_2: stylex.types.length("0.5rem"),
	_2_25: stylex.types.length("0.5625rem"),
	_2_5: stylex.types.length("0.625rem"),
	_2_75: stylex.types.length("0.6875rem"),
	_3: stylex.types.length("0.75rem"),
	_3_25: stylex.types.length("0.8125rem"),
	_3_5: stylex.types.length("0.875rem"),
	_3_75: stylex.types.length("0.9375rem"),
	_4: stylex.types.length("1rem"),
	_4_5: stylex.types.length("1.125rem"),
	_5: stylex.types.length("1.25rem"),
	_5_5: stylex.types.length("1.375rem"),
	_6: stylex.types.length("1.5rem"),
	_7: stylex.types.length("1.75rem"),
	_8: stylex.types.length("2rem"),
	_9: stylex.types.length("2.25rem"),
	_10: stylex.types.length("2.5rem"),
	_12: stylex.types.length("3rem"),
	_16: stylex.types.length("4rem"),
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
	size_6: stylex.types.length("1rem"),
	size_7: stylex.types.length("1.125rem"),
	size_8: stylex.types.length("1.25rem"),
	size_9: stylex.types.length("1.5rem"),
	size_10: stylex.types.length("1.75rem"),
	sizeDisplay: stylex.types.length("1.2rem"),
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
	px5: stylex.types.length("5px"),
	md: stylex.types.length("0.375rem"),
	px7: stylex.types.length("7px"),
	lg: stylex.types.length("0.5rem"),
	px9: stylex.types.length("9px"),
	px10: stylex.types.length("10px"),
	xl: stylex.types.length("0.75rem"),
	px15: stylex.types.length("15px"),
	_2xl: stylex.types.length("1rem"),
	px17: stylex.types.length("17px"),
	_3xl: stylex.types.length("1.25rem"),
	circle: stylex.types.lengthPercentage("50%"),
	pill: stylex.types.length("999px"),
});

export const motion = stylex.defineVars({
	durationInstant: stylex.types.time("0ms"),
	durationQuick: stylex.types.time("80ms"),
	durationSnappy: stylex.types.time("100ms"),
	durationFast: stylex.types.time("120ms"),
	durationBase: stylex.types.time("150ms"),
	durationSlow: stylex.types.time("200ms"),
	durationDeliberate: stylex.types.time("240ms"),
	durationLong: stylex.types.time("700ms"),
	durationLonger: stylex.types.time("800ms"),
	durationLongest: stylex.types.time("900ms"),
	durationSecond: stylex.types.time("1000ms"),
	ease: "ease",
	easeIn: "ease-in",
	easeOut: "ease-out",
	easeInOut: "ease-in-out",
	easeStandard: "cubic-bezier(0.2, 0, 0, 1)",
});

export const shadow = stylex.defineVars({
	none: "none",
	controlDepth: "var(--shadow-inferay-control-depth)",
	controlDepthHover: "var(--shadow-inferay-control-depth-hover)",
	composerFrame: "var(--shadow-inferay-composer-frame)",
	composerFrameFocus: "var(--shadow-inferay-composer-frame-focus)",
	selectedRing: "var(--shadow-inferay-selected-ring)",
	focusRing: "var(--shadow-inferay-focus-ring)",
	popover: "var(--shadow-inferay-popover)",
	modal: "var(--shadow-inferay-modal)",
});

export const effect = stylex.defineVars({
	controlDepth: "var(--effect-inferay-control-depth)",
	controlDepthHover: "var(--effect-inferay-control-depth-hover)",
	popoverDepth: "var(--effect-inferay-popover-depth)",
	tokenHighlightBackground:
		"color-mix(in srgb, var(--color-inferay-accent) 15%, transparent)",
});

export const layer = stylex.defineConsts({
	base: "0",
	content: "1",
	chrome: "2",
	overlayContent: "3",
	canvasControl: "5",
	canvasOverlay: "8",
	control: "10",
	dropdown: "20",
	sticky: "30",
	popover: "40",
	modal: "50",
	panelOverlay: "80",
	workspaceOverlay: "100",
	workspaceDrag: "110",
	titlebar: "120",
	titlebarMenu: "122",
	navigationPopover: "200",
	composerPopover: "220",
	searchPopover: "360",
	dropdownPopover: "320",
	sidebarPopover: "340",
	appModal: "1000",
	criticalOverlay: "9999",
});

export const breakpoint = stylex.defineConsts({
	phoneWide: "@media (min-width: 560px)",
	tablet: "@media (min-width: 640px)",
	paneWide: "@media (min-width: 720px)",
	compact: "@media (max-width: 759px)",
	standard: "@media (min-width: 760px)",
	tabletWide: "@media (min-width: 768px)",
	desktop: "@media (min-width: 860px)",
	wide: "@media (min-width: 1024px)",
	canvasWide: "@media (min-width: 1120px)",
});

export const iconSize = {
	micro: 7,
	xs: 8,
	_2xs: 9,
	sm: 10,
	compact: 11,
	md: 12,
	_2md: 13,
	lg: 14,
	_2lg: 15,
	xl: 16,
	_2xl: 18,
	_3xl: 20,
} as const;

export const runtimeColor = {
	accent: "var(--color-inferay-accent)",
	backgroundSubtle: "var(--inferay-surface-subtle)",
	backgroundRaised: "var(--inferay-surface-raised)",
	backgroundPanel: "var(--inferay-surface-panel)",
	backgroundModal: "var(--inferay-surface-modal)",
	commitAccent: "#f97316",
	commitAccentWashSubtle: "rgba(249, 115, 22, 0.025)",
	commitAccentWash: "rgba(249, 115, 22, 0.08)",
	commitAccentWashStrong: "rgba(249, 115, 22, 0.45)",
	dangerWash: "rgba(239, 68, 68, 0.15)",
	surfaceControl: "var(--inferay-surface-control)",
	surfaceGlassStrong: "var(--inferay-surface-glass-strong)",
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

export const runtimeFont = {
	familyMono: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
	sizeCompact: "11px",
} as const;

export const runtimeLayer = {
	content: 1,
	criticalOverlay: 9999,
} as const;

export const surfaceStyles = stylex.create({
	panel: {
		backgroundColor: color.backgroundPanel,
		borderColor: color.border,
		borderStyle: "solid",
		borderWidth: 1,
		borderRadius: radius.xl,
	},
	explorerRow: {
		backgroundColor: {
			default: color.transparent,
			":hover": color.backgroundPanel,
		},
		boxShadow: {
			default: "none",
			":hover": `inset 0 0 0 1px ${color.border}`,
		},
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, box-shadow",
	},
	stickyExplorerRow: {
		backgroundColor: {
			default: color.background,
			":hover": color.backgroundPanel,
		},
	},
});

export type SelectionVariant = "sidebar" | "repository" | "view" | "list";

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
	];
}

const selection = stylex.create({
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
	sidebar: { borderRadius: radius.md },
	repository: { borderRadius: radius.none },
	view: { borderRadius: radius.sm },
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
	bordered: { borderWidth: 1 },
	selected: {
		backgroundColor: color.backgroundPanel,
		color: color.textMain,
	},
	selectedBorder: { borderColor: color.border },
});
