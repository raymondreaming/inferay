/**
 * Runtime-only design values.
 *
 * StyleX variables are CSS identifiers and cannot be used as ordinary JavaScript
 * values. Keep values needed by SVG props, canvas code, and Liquid render props
 * here; styles declared with stylex.create must use tokens.stylex.ts instead.
 */

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

export type IconSize = (typeof iconSize)[keyof typeof iconSize];

export const runtimeColor = {
	accent: "var(--color-inferay-accent)",
	backgroundRaised: "var(--color-inferay-dark-gray)",
	commitAccent: "#f97316",
	commitAccentWashSubtle: "rgba(249, 115, 22, 0.025)",
	commitAccentWash: "rgba(249, 115, 22, 0.08)",
	commitAccentWashStrong: "rgba(249, 115, 22, 0.45)",
	dangerWash: "rgba(239, 68, 68, 0.15)",
	surfaceControl:
		"color-mix(in srgb, var(--color-inferay-gray) 54%, transparent)",
	surfaceGlassStrong:
		"color-mix(in srgb, var(--color-inferay-black) 30%, transparent)",
	textMain: "var(--color-inferay-white)",
} as const;

export const runtimeFont = {
	familyMono: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
	sizeCompact: "11px",
} as const;

export const runtimeLayer = {
	content: 1,
	criticalOverlay: 9999,
} as const;

export const runtimeEffect = {
	tokenHighlightBackground:
		"color-mix(in srgb, var(--color-inferay-accent) 15%, transparent)",
} as const;
