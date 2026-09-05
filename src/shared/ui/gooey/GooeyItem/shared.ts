import type {
	CSSProperties,
	ReactNode,
} from "../../../../types/octane-react-compat.ts";
import type { GooeyContextValue } from "../context";
import type { CornerRadii } from "../geometry";
import type { EvolveOptions, MoveOptions } from "../observer";
import type { Transition } from "../spring";

export type GooeyEffect = "morph" | "evolve" | "move";

export interface DissolveOptions {
	/** Melt blur in px. Default 8. */
	blur?: number;
	/** Displacement strength of the liquid warp. Default 26. */
	warp?: number;
	/** Magnetic drift toward the contact, px. Default 4. */
	pull?: number;
	/** Distance where melting starts (defaults from the group's goo blur). */
	range?: number;
	/** Size of the melt zone around the contact, px. */
	zone?: number;
	/** 0..1 — two-liquid mixing: erodes the melted copy into tendrils so the
	 *  liquid behind shows through the gaps. Default 0.7 when dissolving. */
	mix?: number;
	/** Px the melt is drawn toward the neighbour's centre (flow gravity). */
	gravity?: number;
	/** 0..1 — how pointy that flow tapers toward the neighbour. */
	taper?: number;
	/** Noise frequency multiplier: <1 broad swirls, >1 fine veins. */
	warpFreq?: number;
	/** Px/s the noise field drifts so the liquid churns. 0 = static. */
	flowSpeed?: number;
	/** 'fractalNoise' (soft billows) or 'turbulence' (veinier). */
	warpStyle?: "fractalNoise" | "turbulence";
	/** Noise octaves; higher = finer swirls. */
	detail?: number;
	/** While false the melt fades out over `releaseMs`, regardless of
	 *  proximity. */
	active?: boolean;
	/** Structural release time when `active` goes false, ms. */
	releaseMs?: number;
	/** Ms the melt takes to evaporate (opacity -> 0), independent of
	 *  `releaseMs`. Defaults to `releaseMs`. */
	fadeMs?: number;
	/** 0..1 — overall dissolve intensity, independent of proximity: caps how
	 *  far the melt can develop even at full contact (scales warp/blur/
	 *  gravity/mix and the hole depth together). Default 1. */
	strength?: number;
	/** How deep this piece may sink into its neighbour before the melt is fully
	 *  gone, as a fraction of the smaller body (1 = completely engulfed).
	 *  Melting is a surface event — once a piece is well inside the other there
	 *  is no seam left to mix at, so the melt recedes and the content resolves
	 *  back to crisp. Default 0.8; raise toward (or past) 1 to keep melting
	 *  while deeply overlapped. */
	sink?: number;
}

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
	/** Mirrored mode: translation applied to both the wrapper and its blob. */
	x?: number;
	y?: number;
	scale?: number;
	/** Mirrored mode: spring preset/config or `{ duration, ease }`. Default 'smooth'. */
	transition?: Transition;
	/** Mirrored mode: transition delay in ms (stagger). Default 0. */
	delay?: number;
	/** Observe mode: you animate the child however you like (Framer Motion, GSAP,
	 *  CSS); the blob follows its rendered rect. `x/y/scale` are ignored. */
	observe?: boolean;
	/** Observe mode: liquid-melt the item's imagery at the point where it
	 *  touches a neighbour — a turbulence-displacement warp bends the image and
	 *  its edge like two materials merging, ramping in as the goo bridge forms.
	 *  `blur` is the melt blur in px (default 8), `warp` the displacement
	 *  strength (default 26), `pull` the magnetic drift toward the contact in px
	 *  (default 4), `range` the distance where melting starts (defaults from the
	 *  group's goo blur). Text is never melted. */
	contactBlur?: boolean | DissolveOptions;
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
