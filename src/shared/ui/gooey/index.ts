import { GooeyRoot } from "./Gooey/index.tsx";
import { LiquidItem } from "./LiquidItem/index.tsx";

/** Liquid group plus its item primitive, ported to Octane. */
export const Liquid = Object.assign(GooeyRoot, {
	Item: LiquidItem,
});
export const Gooey = Liquid;
export type { GooeyProps, GooeyProps as LiquidProps } from "./Gooey/index.tsx";
export { GooeyRoot } from "./Gooey/index.tsx";
export type { GooeyEffect, GooeyItemProps } from "./GooeyItem/index.tsx";
export { GooeyItem } from "./GooeyItem/index.tsx";
export type {
	LiquidEffect,
	LiquidItemProps,
	MorphTuning,
	MoveTuning,
} from "./LiquidItem/index.tsx";
export { LiquidItem } from "./LiquidItem/index.tsx";
export type {
	CornerRadii,
	EvolveOptions,
	GooeySurfacePreset,
	MoveOptions,
} from "./observer.ts";
export {
	EVOLVE_DEFAULTS,
	easingFunction,
	gooeySurfacePresets,
	MOVE_DEFAULTS,
} from "./observer.ts";
