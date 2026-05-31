import * as stylex from "@stylexjs/stylex";

export const colorValues = {
	transparent: "transparent",
	background: "var(--color-inferay-black)",
	backgroundRaised: "var(--color-inferay-dark-gray)",
	backgroundSubtle: "var(--color-inferay-gray)",
	backgroundOverlay: "rgba(0, 0, 0, 0.6)",
	surfaceTranslucent:
		"color-mix(in srgb, var(--color-inferay-dark-gray) 72%, transparent)",
	surfaceInset:
		"color-mix(in srgb, var(--color-inferay-gray) 34%, transparent)",
	surfaceSubtle:
		"color-mix(in srgb, var(--color-inferay-gray) 34%, transparent)",
	surfaceControl:
		"color-mix(in srgb, var(--color-inferay-gray) 54%, transparent)",
	surfaceControlHover:
		"color-mix(in srgb, var(--color-inferay-light-gray) 62%, transparent)",
	border: "var(--color-inferay-gray-border)",
	borderSubtle:
		"color-mix(in srgb, var(--color-inferay-gray-border) 48%, transparent)",
	borderStrong: "var(--color-inferay-gray-border-bold)",
	borderControl: "var(--color-inferay-gray-border-bold)",
	focusRing: "color-mix(in srgb, var(--color-inferay-info) 58%, transparent)",
	controlHover: "var(--color-inferay-gray)",
	controlActive:
		"color-mix(in srgb, var(--color-inferay-gray) 82%, var(--color-inferay-light-gray) 18%)",
	textMain: "var(--color-inferay-white)",
	textSoft: "var(--color-inferay-soft-white)",
	textMuted: "var(--color-inferay-muted-gray)",
	textFaint: "rgba(255, 255, 255, 0.3)",
	accent: "var(--color-inferay-accent)",
	accentHover: "var(--color-inferay-accent-hover)",
	accentForeground: "var(--color-inferay-accent-foreground)",
	accentWash:
		"color-mix(in srgb, var(--color-inferay-gray) 86%, var(--color-inferay-light-gray) 14%)",
	accentBorder:
		"color-mix(in srgb, var(--color-inferay-gray-border-bold) 72%, var(--color-inferay-light-gray) 28%)",
	danger: "var(--color-inferay-error)",
	dangerHover: "rgba(239, 68, 68, 0.2)",
	dangerWash: "rgba(239, 68, 68, 0.15)",
	dangerBorder: "rgba(239, 68, 68, 0.2)",
	success: "var(--color-inferay-success)",
	successWash: "rgba(16, 185, 129, 0.1)",
	successBorder: "rgba(16, 185, 129, 0.4)",
	warning: "var(--color-inferay-warning)",
	warningWash: "rgba(245, 158, 11, 0.1)",
	warningBorder: "rgba(245, 158, 11, 0.4)",
	gitAdded: "var(--color-git-added)",
	gitModified: "var(--color-git-modified)",
	gitDeleted: "var(--color-git-deleted)",
	gitRenamed: "var(--color-git-renamed)",
	gitUnmerged: "var(--color-git-unmerged)",
} as const;

const controlSizeValues = {
	_0: "0",
	_0_5: "0.125rem",
	_1: "0.25rem",
	_1_5: "0.375rem",
	_2: "0.5rem",
	_2_5: "0.625rem",
	_3: "0.75rem",
	_4: "1rem",
	_5: "1.25rem",
	_6: "1.5rem",
	_7: "1.75rem",
	_8: "2rem",
	_9: "2.25rem",
	_10: "2.5rem",
	_12: "3rem",
	_16: "4rem",
} as const;

const fontValues = {
	familyMono: "var(--font-mono)",
	familyDiff: "var(--font-diff)",
	size_0: "0.4375rem",
	size_0_5: "0.5rem",
	size_1: "0.5625rem",
	size_2: "0.625rem",
	size_3: "0.75rem",
	size_4: "0.8125rem",
	size_5: "0.875rem",
	weight_5: "500",
	weight_6: "600",
} as const;

const radiusValues = {
	none: "0",
	xs: "0.125rem",
	sm: "0.25rem",
	md: "0.375rem",
	lg: "0.5rem",
	xl: "0.75rem",
	pill: "999px",
} as const;

const motionValues = {
	durationFast: "120ms",
	durationBase: "150ms",
	durationSlow: "200ms",
	ease: "ease",
} as const;

const shadowValues = {
	none: "none",
	controlDepth:
		"var(--shadow-inferay-control-depth, inset 0 1px 0 rgba(255, 255, 255, 0.045), inset 0 -1px 0 rgba(0, 0, 0, 0.42))",
	controlDepthHover:
		"var(--shadow-inferay-control-depth-hover, inset 0 1px 0 rgba(255, 255, 255, 0.055), inset 0 -1px 0 rgba(0, 0, 0, 0.48))",
	composerFrame:
		"var(--shadow-inferay-composer-frame, inset 0 1px 0 rgba(255, 255, 255, 0.055), inset 0 -1px 0 rgba(0, 0, 0, 0.48), 0 18px 42px rgba(0, 0, 0, 0.34))",
	composerFrameFocus:
		"var(--shadow-inferay-composer-frame-focus, inset 0 1px 0 rgba(255, 255, 255, 0.075), inset 0 -1px 0 rgba(0, 0, 0, 0.52), 0 22px 52px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(255, 255, 255, 0.035))",
	selectedRing:
		"var(--shadow-inferay-selected-ring, 0 0 0 1px rgba(255, 255, 255, 0.05))",
	focusRing:
		"var(--shadow-inferay-focus-ring, 0 0 0 1px rgba(229, 229, 231, 0.35))",
	popover: "var(--shadow-inferay-popover, 0 10px 15px -3px rgba(0, 0, 0, 0.6))",
	modal: "var(--shadow-inferay-modal, 0 25px 50px -12px rgba(0, 0, 0, 0.7))",
} as const;

export const effectValues = {
	controlDepth:
		"var(--effect-inferay-control-depth, linear-gradient(180deg, rgba(255, 255, 255, 0.018), rgba(0, 0, 0, 0.08) 48%, rgba(0, 0, 0, 0.2)))",
	controlDepthHover:
		"var(--effect-inferay-control-depth-hover, linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(0, 0, 0, 0.1) 48%, rgba(0, 0, 0, 0.24)))",
	popoverDepth:
		"var(--effect-inferay-popover-depth, linear-gradient(180deg, rgba(255, 255, 255, 0.014), rgba(0, 0, 0, 0.08) 42%, rgba(0, 0, 0, 0.22)))",
	composerBackdrop:
		"linear-gradient(to bottom, transparent 0%, color-mix(in srgb, var(--color-inferay-black) 90%, transparent) 38%, var(--color-inferay-black) 72%)",
	composerFade:
		"linear-gradient(to bottom, transparent 0%, color-mix(in srgb, var(--color-inferay-black) 82%, transparent) 58%, var(--color-inferay-black) 100%)",
	tokenHighlightBackground:
		"color-mix(in srgb, var(--color-inferay-accent) 15%, transparent)",
} as const;

export const color = stylex.defineVars(colorValues);
export const controlSize = stylex.defineVars(controlSizeValues);
export const font = stylex.defineVars(fontValues);
export const radius = stylex.defineVars(radiusValues);
export const motion = stylex.defineVars(motionValues);
export const shadow = stylex.defineVars(shadowValues);
// fallow-ignore-next-line unused-export
export const effect = stylex.defineVars(effectValues);

export const colorTheme = stylex.createTheme(color, colorValues);
export const controlSizeTheme = stylex.createTheme(
	controlSize,
	controlSizeValues
);
export const fontTheme = stylex.createTheme(font, fontValues);
export const radiusTheme = stylex.createTheme(radius, radiusValues);
export const motionTheme = stylex.createTheme(motion, motionValues);
export const shadowTheme = stylex.createTheme(shadow, shadowValues);
export const effectTheme = stylex.createTheme(effect, effectValues);
