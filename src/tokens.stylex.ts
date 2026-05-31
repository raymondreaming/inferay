import * as stylex from "@stylexjs/stylex";

export const colorValues = {
	transparent: "transparent",
	background: "var(--color-inferay-black)",
	backgroundRaised: "var(--color-inferay-dark-gray)",
	backgroundSubtle: "var(--color-inferay-gray)",
	backgroundOverlay: "rgba(0, 0, 0, 0.6)",
	surfaceTranslucent: "rgba(28, 28, 30, 0.2)",
	surfaceInset: "rgba(0, 0, 0, 0.15)",
	surfaceSubtle: "rgba(255, 255, 255, 0.04)",
	surfaceControl: "rgba(255, 255, 255, 0.055)",
	surfaceControlHover: "rgba(255, 255, 255, 0.085)",
	border: "rgba(255, 255, 255, 0.075)",
	borderSubtle: "rgba(255, 255, 255, 0.028)",
	borderStrong: "rgba(255, 255, 255, 0.13)",
	borderControl: "rgba(255, 255, 255, 0.12)",
	focusRing: "rgba(229, 229, 231, 0.6)",
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
		"inset 0 1px 12px rgba(0, 0, 0, 0.18), inset 0 -1px 0 rgba(255, 255, 255, 0.025), 0 8px 22px rgba(0, 0, 0, 0.22)",
	controlDepthHover:
		"inset 0 1px 14px rgba(0, 0, 0, 0.22), inset 0 -1px 0 rgba(255, 255, 255, 0.03), 0 10px 26px rgba(0, 0, 0, 0.28)",
	selectedRing: "0 0 0 1px rgba(255, 255, 255, 0.05)",
	focusRing: "0 0 0 1px rgba(229, 229, 231, 0.35)",
	popover: "0 10px 15px -3px rgba(0, 0, 0, 0.6)",
	modal: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
} as const;

export const effectValues = {
	controlDepth:
		"linear-gradient(180deg, rgba(255, 255, 255, 0.018), rgba(0, 0, 0, 0.08) 48%, rgba(0, 0, 0, 0.2))",
	controlDepthHover:
		"linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(0, 0, 0, 0.1) 48%, rgba(0, 0, 0, 0.24))",
	popoverDepth:
		"linear-gradient(180deg, rgba(255, 255, 255, 0.014), rgba(0, 0, 0, 0.08) 42%, rgba(0, 0, 0, 0.22))",
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
