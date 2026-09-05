import type {
	CSSProperties,
	ReactNode,
} from "../../../../types/octane-react-compat.ts";
import type { GooeyContextValue } from "../context";
import type { CornerRadii } from "../geometry";
import type { EvolveOptions, MoveOptions } from "../observer";

export type GooeyEffect = "morph" | "evolve" | "move";

export interface GooeyItemProps {
	/** Liquid behavior of this piece:
	 *  - 'morph' (default): merges gooily with touching neighbours.
	 *  - 'evolve': the surface springs behind size/shape changes and settles
	 *    like jelly.
	 *  - 'move': the surface lags a moving element and stretches with velocity —
	 *    liquid rubber (great for dragged things).
	 *  Combine with an array. Anything beyond 'morph' runs on the measurement
	 *  engine, so it implies observe mode. */
	effect?: GooeyEffect | GooeyEffect[];
	/** Tuning for effect="evolve": springs for mass / size / corner radius,
	 *  content cross-blur, and droplet roundness. See EvolveOptions. */
	evolve?: EvolveOptions;
	/** Tuning for effect="move": trail spring, velocity stretch, tail size. */
	move?: MoveOptions;
	/** Observe mode: you animate the child however you like (Framer Motion, GSAP,
	 *  CSS); the blob follows its rendered rect. */
	observe?: boolean;
	/** Override the measured border-radius for the blob (px). */
	radius?: number | CornerRadii;
	/** Observe mode: shrink the blob by this many px on every side, so an opaque
	 *  element (e.g. a round photo) fully covers its own liquid — white then
	 *  only appears as the merge bridge. */
	blobInset?: number;
	/** Observe mode: px the blob swells back out (beyond blobInset) as the item
	 *  nears a neighbour — the element visibly grows a liquid coat that necks
	 *  into the other surface. */
	bridgeGrow?: number;
	className?: string;
	style?: CSSProperties;
	children?: ReactNode;
}

export function toEffects(
	effect: GooeyEffect | GooeyEffect[] | undefined,
): GooeyEffect[] {
	return Array.isArray(effect) ? effect : effect ? [effect] : [];
}

export type Internal = GooeyItemProps & { ctx: GooeyContextValue };
