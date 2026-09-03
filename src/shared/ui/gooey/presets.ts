import type { GooeyProps } from "./Gooey";

export type GooeySurfacePreset = Pick<
	GooeyProps,
	"blur" | "contrast" | "fill" | "shadow" | "filterPadding"
>;

/** Inferay-ready surfaces. They only describe the liquid layer; layout and
 * interactive content remain owned by the consuming component. */
export const gooeySurfacePresets = {
	chrome: {
		blur: 6,
		contrast: 18,
		fill: "var(--color-inferay-dark-gray)",
		shadow:
			"inset 0 1px 0 rgba(255,255,255,.32), 0 1px 2px rgba(0,0,0,.08), 0 10px 30px rgba(0,0,0,.08)",
		filterPadding: 24,
	},
	control: {
		blur: 5,
		contrast: 20,
		fill: "var(--color-inferay-dark-gray)",
		shadow: "inset 0 1px 0 rgba(255,255,255,.28), 0 2px 8px rgba(0,0,0,.10)",
		filterPadding: 18,
	},
	soft: {
		blur: 10,
		contrast: 16,
		fill: "var(--color-inferay-gray)",
		shadow: "0 12px 38px rgba(0,0,0,.10)",
		filterPadding: 34,
	},
} satisfies Record<string, GooeySurfacePreset>;
