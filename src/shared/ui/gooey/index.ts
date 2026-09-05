import { GooeyRoot } from "./Gooey";
import { LiquidItem } from "./LiquidItem";

/** Liquid group plus its item primitive, ported to Octane. */
export const Liquid = Object.assign(GooeyRoot, { Item: LiquidItem });
export const Gooey = Liquid;

export type { GooeyProps, GooeyProps as LiquidProps } from "./Gooey";
export { GooeyRoot } from "./Gooey";
export type {
	GooeyEffect,
	GooeyItemProps,
} from "./GooeyItem";
export { GooeyItem } from "./GooeyItem";
export type { CornerRadii } from "./geometry";
export type {
	LiquidEffect,
	LiquidItemProps,
	MorphTuning,
	MoveTuning,
} from "./LiquidItem";
export { LiquidItem } from "./LiquidItem";
export type { EvolveOptions, MoveOptions } from "./observer";
export { EVOLVE_DEFAULTS, MOVE_DEFAULTS } from "./observer";
export type { GooeySurfacePreset } from "./presets";
export { gooeySurfacePresets } from "./presets";
export { easingFunction } from "./spring";
