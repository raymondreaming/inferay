import { measureRadius } from "./geometry";
import { easingFunction } from "./spring";

export interface EvolveOptions {
	/** Spring driving the liquid mass's centre. Default 320 / 17. */
	massStiffness?: number;
	massDamping?: number;
	/** Spring driving width/height. Default 170 / 11.5. */
	sizeStiffness?: number;
	sizeDamping?: number;
	/** Spring driving the corner radius. Default 900 / 60 — stiff and
	 *  overdamped, so the element's own border-radius transition timing shows
	 *  through instead of the spring imposing its own. Soften it to make the
	 *  corners lag the element. */
	radiusStiffness?: number;
	radiusDamping?: number;
	/** Max content cross-blur during the morph, px. 0 disables. Default 7. */
	contentBlur?: number;
	/** 0..1 — how strongly the blob rounds into a droplet while morphing. Default 1. */
	roundness?: number;
	/** Corner-forming timeline: starts at the very beginning of the morph and
	 *  runs droplet-round → target radius over `cornerDuration` ms with
	 *  `cornerEase` (a cubic-bezier(...) string, 'ease-in-out' or 'linear'),
	 *  after `cornerDelay` ms. No motion gating — tweak duration/easing and it
	 *  behaves like a normal animation. Defaults 460 / 0 / smooth. */
	cornerDuration?: number;
	cornerDelay?: number;
	cornerEase?: string;
	/** Ms the travel lead takes to ramp in — how EAGERLY the droplet commits to
	 *  the destination. 0 leads instantly; it never scales the reach.
	 *  Default 90. */
	anticipation?: number;
	/** Px the mass centre leads ahead of the element — how FAR the droplet
	 *  travels toward the destination before it inflates. 0 disables.
	 *  Default 32. */
	travel?: number;
}

export const EVOLVE_DEFAULTS: Required<EvolveOptions> = {
	massStiffness: 320,
	massDamping: 17,
	sizeStiffness: 170,
	sizeDamping: 11.5,
	radiusStiffness: 900,
	radiusDamping: 60,
	contentBlur: 7,
	roundness: 1,
	cornerDuration: 460,
	cornerDelay: 0,
	cornerEase: "cubic-bezier(0.3, 1.05, 0.4, 1)",
	anticipation: 90,
	travel: 32,
};

// Keep the observer's accepted curves and linear fallback while sharing evaluation.
function easingFn(spec: string): (t: number) => number {
	const curve = /cubic-bezier\(([^)]+)\)/.exec(spec)?.[0];
	return easingFunction(curve ?? (spec === "ease-in-out" ? spec : "linear"));
}

export interface MoveOptions {
	/** Spring pulling the liquid surface after the element. Lower stiffness /
	 *  damping = a laggier, more rubbery trail. Default 380 / 18. */
	stiffness?: number;
	damping?: number;
	/** Max axial stretch at speed (0 = rigid). Default 0.18. */
	stretch?: number;
	/** Trailing droplet size as a fraction of the body. 0 disables the tail.
	 *  Default 0.46. */
	tail?: number;
}

export const MOVE_DEFAULTS: Required<MoveOptions> = {
	stiffness: 380,
	damping: 18,
	stretch: 0.18,
	tail: 0.46,
};

export interface ItemDynamics {
	/** Liquid surface springs behind size/shape changes and settles like jelly. */
	evolve: boolean;
	/** Surface lags the moving element and stretches with velocity — liquid rubber. */
	move: boolean;
	/** Resolved evolve tuning; falls back to EVOLVE_DEFAULTS. */
	evolveOpts?: Required<EvolveOptions>;
	/** Resolved move tuning; falls back to MOVE_DEFAULTS. */
	moveOpts?: Required<MoveOptions>;
}

export interface ObservedTarget {
	target: HTMLElement;
	blob: SVGRectElement;
	radius?: number;
	/** Px to shrink the blob on every side relative to the element — lets an
	 *  opaque element (e.g. a round photo) fully cover its own liquid so white
	 *  only appears as the merge bridge. */
	blobInset?: number;
	/** Px the blob swells back OUT (beyond blobInset) as the item nears a
	 *  neighbour — an opaque element visibly grows a liquid coat that necks
	 *  into the other surface, instead of merging invisibly behind itself. */
	bridgeGrow?: number;
	dynamics?: ItemDynamics;
}

interface Frame {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Total length of the corner timeline (delay + duration). */
function cornerTotalOf(eo: Required<EvolveOptions>): number {
	return Math.max(0, eo.cornerDelay) + Math.max(1, eo.cornerDuration);
}

/** Clamp a CSS corner radius for use as an SVG rect `rx`.
 *
 *  SVG clamps `rx` to w/2 and `ry` (defaulted from rx) to h/2 INDEPENDENTLY,
 *  so a large radius on a wide short box — the `border-radius: 999px` pill
 *  idiom — degenerates into an ellipse. Clamping to min(w,h)/2 keeps it a
 *  true pill, matching how CSS renders the same value. */
function pillRadius(r: number, w: number, h: number): number {
	return Math.max(0, Math.min(r, Math.min(w, h) / 2));
}

/** Centre-based liquid body: the mass's centre leads, size follows, corner
 *  radius adapts last — the order real liquid reads as. */
interface Sim {
	cx: number;
	cy: number;
	w: number;
	h: number;
	r: number;
	vcx: number;
	vcy: number;
	vw: number;
	vh: number;
	vr: number;
}

interface Item extends ObservedTarget {
	baseW: number;
	baseH: number;
	radiusPx: number;
	last: Frame | null;
	frame: Frame | null;
	sim: Sim | null;
	/** Peak-hold envelope of morph motion: rises instantly, decays smoothly —
	 *  keeps roundness/blur monotone through the springs' settle oscillations. */
	motionEnv: number;
	/** Previous target centre + smoothed target velocity, for anticipation. */
	tPrev: { cx: number; cy: number } | null;
	tvx: number;
	tvy: number;
	/** Ramp-in envelope for the travel lead, 0..1, timed by `anticipation`. */
	lead01: number;
	/** Corner timeline: morph start time + target-size change tracking. */
	cornerT0: number;
	lastTargetMoveT: number;
	lastTargetSize: { w: number; h: number } | null;
	/** Latch: a morph is in progress, so the corner timeline can't restart. */
	morphActive: boolean;
	/** Rate-limited droplet-roundness value — glides, never steps. */
	round01: number;
	/** Trailing droplet for move items: a laggier satellite the goo filter
	 *  strings into a teardrop tail while the element is in motion. */
	tailEl: SVGCircleElement | null;
	tailX: number;
	tailY: number;
	tailVx: number;
	tailVy: number;
	tailR: number;
	/** True while an evolve morph has a motion blur written onto the target. */
	contentBlurred: boolean;
	/** Last values painted to the blob by the dynamics branch. Writes are
	 *  skipped when unchanged: the 300ms asleep-check calls writeBlob too, and
	 *  an unconditional setAttribute — even with an identical value — dirties
	 *  the SVG filter, which Safari answers by re-rasterizing the whole filter
	 *  region. A settled sim must be DOM-silent. */
	lastPaint: { t: string; w: string; h: string; rx: string } | null;
	/** Last tail-circle write ('hidden' when parked at r=0), same reason. */
	lastTail: string | null;
	/** Last effective blob inset written (bridgeGrow makes it proximity-driven). */
	lastBi: number;
	/** Time-smoothed bridgeGrow inset; null until the first frame seeds it. */
	biSmooth: number | null;
	ro: ResizeObserver;
}

/** Semi-implicit Euler spring step; returns [position, velocity]. */
function springStep(
	cur: number,
	vel: number,
	target: number,
	k: number,
	c: number,
	dt: number,
): [number, number] {
	const a = k * (target - cur) - c * vel;
	const v = vel + a * dt;
	return [cur + v * dt, v];
}

/** Spring advance over a WALL-CLOCK dt, substepped at ≤1/60s so the
 *  integration stays stable no matter how long the frame gap was.
 *
 *  The loop used to clamp dt to 1/24 per FRAME instead: at Safari's worst
 *  (~1 paint per 2s under filter load) the simulation then advanced 42ms per
 *  2000ms of wall time — everything ran in ~50x slow motion, so timed melt
 *  releases visibly never finished (avatars stayed erased) and silhouettes
 *  trailed their elements by seconds. Time must follow the wall clock; only
 *  the integration STEP is capped. */
function springSteps(
	cur: number,
	vel: number,
	target: number,
	k: number,
	c: number,
	dt: number,
): [number, number] {
	let n = Math.max(1, Math.ceil(dt * 60));
	const h = dt / n;
	let p = cur;
	let v = vel;
	while (n-- > 0) {
		const step = springStep(p, v, target, k, c, h);
		p = step[0];
		v = step[1];
	}
	return [p, v];
}

const SVG_NS = "http://www.w3.org/2000/svg";

function smoothstep(t: number): number {
	const c = Math.min(1, Math.max(0, t));
	return c * c * (3 - 2 * c);
}

function svg<K extends keyof SVGElementTagNameMap>(
	tag: K,
	attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
	const el = document.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
	return el;
}

/** Shared per-group measurement loop for observe-mode items: mirrors externally
 *  animated elements onto their blobs each frame, then sleeps entirely once
 *  nothing has moved for ~half a second. MutationObserver + transition /
 *  animation events + a slow safety tick wake it, so idle cost is zero.
 */
export class ObserveEngine {
	/** Goo blur of the owning group; used to derive the bridge-growth range. */
	gooBlur = 6;

	private items = new Set<Item>();
	private awake = false;
	private clean = 0;
	private raf = 0;
	private sourcesReady = false;
	private mo: MutationObserver | null = null;
	private interval: ReturnType<typeof setInterval> | null = null;
	private removeListeners: Array<() => void> = [];

	constructor(private getGroup: () => HTMLElement | null) {}

	add(t: ObservedTarget): () => void {
		const item: Item = {
			...t,
			baseW: t.target.offsetWidth || 1,
			baseH: t.target.offsetHeight || 1,
			radiusPx: this.resolveRadius(t),
			last: null,
			frame: null,
			sim: null,
			motionEnv: 0,
			tPrev: null,
			tvx: 0,
			tvy: 0,
			lead01: 0,
			cornerT0: 0,
			lastTargetMoveT: 0,
			lastTargetSize: null,
			morphActive: false,
			round01: 0,
			tailEl: null,
			tailX: 0,
			tailY: 0,
			tailVx: 0,
			tailVy: 0,
			tailR: 0,
			contentBlurred: false,
			lastPaint: null,
			lastTail: null,
			lastBi: t.blobInset ?? 0,
			biSmooth: null,
			ro: new ResizeObserver(() => {
				item.baseW = t.target.offsetWidth || 1;
				item.baseH = t.target.offsetHeight || 1;
				item.radiusPx = this.resolveRadius(t);
				this.wake();
			}),
		};
		item.ro.observe(t.target);
		this.items.add(item);
		if (t.dynamics?.move) {
			// Painted before (below) the main blob; the goo merge does the rest.
			const tail = svg("circle", { cx: "0", cy: "0", r: "0" });
			t.blob.parentNode?.insertBefore(tail, t.blob);
			item.tailEl = tail;
		}
		this.ensureSources();
		this.measureAll();
		this.wake();
		return () => {
			item.ro.disconnect();
			this.items.delete(item);
			if (item.contentBlurred) item.target.style.removeProperty("filter");
			item.tailEl?.remove();
		};
	}

	wake = (): void => {
		this.clean = 0;
		if (this.awake || this.items.size === 0) return;
		this.awake = true;
		this.raf = requestAnimationFrame(this.loop);
	};

	dispose(): void {
		cancelAnimationFrame(this.raf);
		this.mo?.disconnect();
		this.removeListeners.forEach((off) => {
			off();
		});
		this.removeListeners = [];
		if (this.interval) clearInterval(this.interval);
		this.items.forEach((i) => {
			i.ro.disconnect();
		});
		this.items.clear();
		this.awake = false;
		this.sourcesReady = false;
	}

	private resolveRadius(t: ObservedTarget): number {
		if (t.radius != null) return t.radius;
		return measureRadius(
			t.target,
			t.target.offsetWidth,
			t.target.offsetHeight,
		)[0];
	}

	private lastNow = 0;

	private loop = (now: number): void => {
		if (this.items.size === 0) {
			this.awake = false;
			this.lastNow = 0;
			return;
		}
		// WALL-CLOCK dt (capped only against tab-switch gaps): timed fades and
		// smoothing must complete in real time even when paints are slow —
		// springs handle large dt via substepping (see springSteps).
		const dt = this.lastNow
			? Math.min(0.25, Math.max(1 / 240, (now - this.lastNow) / 1000))
			: 1 / 60;
		this.lastNow = now;
		if (this.measureAll(dt)) this.clean = 0;
		else this.clean++;
		if (this.clean > 30) {
			this.awake = false;
			this.lastNow = 0;
			return;
		}
		this.raf = requestAnimationFrame(this.loop);
	};

	private measureAll(dt = 1 / 60): boolean {
		const group = this.getGroup();
		if (!group || this.items.size === 0) return false;
		const g = group.getBoundingClientRect();
		let changed = false;
		// Read all neighbour geometry before writing any blob attributes.
		for (const item of this.items) {
			const r = item.target.getBoundingClientRect();
			item.frame = {
				x: r.left - g.left,
				y: r.top - g.top,
				w: r.width,
				h: r.height,
			};
		}
		for (const item of this.items) {
			if (this.writeBlob(item, dt)) changed = true;
		}
		return changed;
	}

	/** Effective blob inset: bridgeGrow pulls it toward negative (a visible
	 *  liquid coat) as the nearest neighbour approaches.
	 *
	 *  Smoothed on a time constant rather than tracking proximity instantly.
	 *  The raw value is a function of the dragged neighbour's position, so it
	 *  moves as fast as the pointer does and lands on a different value every
	 *  frame; the blob grows symmetrically from it, so that per-frame step is
	 *  visible on the silhouette's far edge as a size flicker. It stayed small
	 *  enough to read as smooth at 60fps, but a frame-rate drop multiplies the
	 *  per-frame delta — which is why the pill's left edge flashed in Safari
	 *  and not in Chromium. dt-based smoothing makes the growth rate identical
	 *  at any frame rate. */
	private effectiveInset(item: Item, dt: number): number {
		let bi = item.blobInset ?? 0;
		const grow = item.bridgeGrow ?? 0;
		if (grow > 0 && item.frame) {
			const f = item.frame;
			const range = Math.max(14, this.gooBlur * 3);
			let best = Infinity;
			for (const other of this.items) {
				if (other === item || !other.frame) continue;
				const o = other.frame;
				const dx = Math.max(o.x - (f.x + f.w), f.x - (o.x + o.w), 0);
				const dy = Math.max(o.y - (f.y + f.h), f.y - (o.y + o.h), 0);
				const gap = Math.hypot(dx, dy);
				if (gap < best) best = gap;
			}
			if (best < range) bi -= grow * smoothstep(1 - best / range);
		}
		if (grow <= 0) {
			item.biSmooth = bi;
			return bi;
		}
		if (item.biSmooth === null) item.biSmooth = bi;
		else item.biSmooth += (bi - item.biSmooth) * Math.min(1, dt * 18);
		return item.biSmooth;
	}

	private writeBlob(item: Item, dt: number): boolean {
		const f = item.frame!;
		const dyn = item.dynamics;
		if (!dyn || (!dyn.evolve && !dyn.move)) {
			const bi = this.effectiveInset(item, dt);
			const last = item.last;
			const frameChanged =
				!last ||
				Math.abs(last.x - f.x) >= 0.05 ||
				Math.abs(last.y - f.y) >= 0.05 ||
				Math.abs(last.w - f.w) >= 0.05 ||
				Math.abs(last.h - f.h) >= 0.05;
			const biChanged = Math.abs(bi - item.lastBi) >= 0.05;
			if (!frameChanged && !biChanged) return false;
			item.blob.style.transform = `translate(${f.x + bi}px, ${f.y + bi}px)`;
			if (frameChanged || biChanged) {
				const bw = Math.max(0, f.w - bi * 2);
				const bh = Math.max(0, f.h - bi * 2);
				item.blob.setAttribute("width", String(bw));
				item.blob.setAttribute("height", String(bh));
				// CSS border-radius doesn't scale with transforms, but the rendered
				// corner does — track it through the rect/layout-width ratio.
				const scale = item.baseW > 0 ? f.w / item.baseW : 1;
				item.blob.setAttribute(
					"rx",
					String(pillRadius(item.radiusPx * scale - bi, bw, bh)),
				);
			}
			// This branch bypasses the dynamics paint cache — drop it so a later
			// dynamics frame can't mistake the DOM for already matching.
			item.lastPaint = null;
			item.last = f;
			item.lastBi = bi;
			return true;
		}

		// Liquid dynamics: the surface is a simulated body chasing the element.
		// Centre-based on purpose: the mass's CENTRE moves first (fast spring),
		// size follows on a slower jelly spring, corner radius adapts last —
		// liquid flows to where it's going before it takes the new shape.
		const tcx = f.x + f.w / 2;
		const tcy = f.y + f.h / 2;
		// Evolve re-measures the element's border-radius every frame, so the
		// element's OWN css transition timing (duration/easing) shows through on
		// the liquid surface. A one-time snapshot would ignore it entirely.
		let tr: number;
		if (dyn.evolve) {
			// measureRadius already resolves the CURRENT radius for the CURRENT
			// box (px values pass through as-is; % values resolve against the
			// ow/oh passed in) — no further scaling is needed or correct here.
			// The previous version additionally multiplied by (f.w / ow): the
			// getBoundingClientRect width (f.w, float) vs offsetWidth (ow, an
			// independently-rounded integer) differ by sub-pixel noise on every
			// animation frame, especially under Safari's own layout rounding
			// during a live width transition. That near-1.0 ratio contributed
			// nothing functionally but injected exactly that noise into the
			// radius spring's target — which a near-critically-damped spring
			// tracks almost instantly, i.e. visible per-frame jitter ("flashing")
			// on the rendered corner.
			const ow = item.target.offsetWidth;
			const oh = item.target.offsetHeight;
			tr = measureRadius(item.target, ow, oh)[0];
		} else {
			tr = item.radiusPx * (item.baseW > 0 ? f.w / item.baseW : 1);
		}
		if (!item.sim) {
			item.sim = {
				cx: tcx,
				cy: tcy,
				w: f.w,
				h: f.h,
				r: tr,
				vcx: 0,
				vcy: 0,
				vw: 0,
				vh: 0,
				vr: 0,
			};
		}
		const s = item.sim;
		if (dyn.move) {
			// Lag + wobble: liquid rubber trailing the element.
			const mo = dyn.moveOpts ?? MOVE_DEFAULTS;
			[s.cx, s.vcx] = springSteps(
				s.cx,
				s.vcx,
				tcx,
				mo.stiffness,
				mo.damping,
				dt,
			);
			[s.cy, s.vcy] = springSteps(
				s.cy,
				s.vcy,
				tcy,
				mo.stiffness,
				mo.damping,
				dt,
			);
		} else if (dyn.evolve) {
			// Mass moves first: springs can only chase, so aim AHEAD of the moving
			// target by its (smoothed) velocity — the droplet travels toward the
			// destination while still small, then the size catches up.
			const eo = dyn.evolveOpts ?? EVOLVE_DEFAULTS;
			const rawVx = item.tPrev ? (tcx - item.tPrev.cx) / dt : 0;
			const rawVy = item.tPrev ? (tcy - item.tPrev.cy) / dt : 0;
			item.tvx = item.tvx * 0.7 + rawVx * 0.3;
			item.tvy = item.tvy * 0.7 + rawVy * 0.3;
			item.tPrev = { cx: tcx, cy: tcy };
			// Lead direction: the target's own velocity while it is moving, else
			// whatever distance the droplet still has to cover.
			const remX = tcx - s.cx;
			const remY = tcy - s.cy;
			const rem = Math.hypot(remX, remY);
			const vMag = Math.hypot(item.tvx, item.tvy);
			let dx = 0;
			let dy = 0;
			if (vMag > 1e-3) {
				dx = item.tvx / vMag;
				dy = item.tvy / vMag;
			} else if (rem > 1e-3) {
				dx = remX / rem;
				dy = remY / rem;
			}
			// `anticipation` only times the ramp-in; it must never scale the reach,
			// or a small value would silently cancel `travel`.
			const tau = Math.max(0, eo.anticipation) / 1000;
			const k = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
			item.lead01 += ((rem > 0.5 ? 1 : 0) - item.lead01) * k;
			// Clamping the reach to the remaining distance keeps the lead from
			// pulling the spring target past the destination as it arrives.
			const reach = Math.min(Math.max(0, eo.travel) * item.lead01, rem);
			const ox = dx * reach;
			const oy = dy * reach;
			[s.cx, s.vcx] = springSteps(
				s.cx,
				s.vcx,
				tcx + ox,
				eo.massStiffness,
				eo.massDamping,
				dt,
			);
			[s.cy, s.vcy] = springSteps(
				s.cy,
				s.vcy,
				tcy + oy,
				eo.massStiffness,
				eo.massDamping,
				dt,
			);
		} else {
			s.cx = tcx;
			s.cy = tcy;
			s.vcx = 0;
			s.vcy = 0;
		}
		if (dyn.evolve) {
			// Size adapts after the mass, radius after the size.
			const eo = dyn.evolveOpts ?? EVOLVE_DEFAULTS;
			[s.w, s.vw] = springSteps(
				s.w,
				s.vw,
				f.w,
				eo.sizeStiffness,
				eo.sizeDamping,
				dt,
			);
			[s.h, s.vh] = springSteps(
				s.h,
				s.vh,
				f.h,
				eo.sizeStiffness,
				eo.sizeDamping,
				dt,
			);
			// Default near-critical damping: the corner radius must land without
			// bouncing — the roundness envelope already supplies the liquid overshoot.
			[s.r, s.vr] = springSteps(
				s.r,
				s.vr,
				tr,
				eo.radiusStiffness,
				eo.radiusDamping,
				dt,
			);
		} else {
			s.w = f.w;
			s.h = f.h;
			s.r = tr;
			s.vw = 0;
			s.vh = 0;
			s.vr = 0;
		}
		let extra = "";
		const speed = Math.hypot(s.vcx, s.vcy);
		if (dyn.move && speed > 2) {
			// Mild stretch along the velocity axis — the drop shape itself comes
			// from the trailing satellite below, not from squashing the body into
			// an ellipse.
			const st = Math.min(
				(dyn.moveOpts ?? MOVE_DEFAULTS).stretch,
				speed * 0.0006,
			);
			const a = Math.round(Math.atan2(s.vcy, s.vcx) * 100) / 100;
			extra += ` rotate(${a}rad) scale(${(1 + st).toFixed(3)}, ${(1 / (1 + st * 0.65)).toFixed(3)}) rotate(${-a}rad)`;
		}
		if (dyn.move && item.tailEl) {
			// Trailing droplet: chases the body's centre on a laggier spring and
			// swells with speed — the goo filter strings body + satellite into a
			// moving-drop silhouette with a liquid tail. The lag is clamped so the
			// satellite always overlaps the body's blur field: a small circle on
			// its own sits below the goo alpha threshold and would simply vanish.
			const round = (v: number) => Math.round(v * 10) / 10;
			if (
				item.tailR === 0 &&
				Math.abs(item.tailX) < 0.001 &&
				Math.abs(item.tailY) < 0.001
			) {
				item.tailX = s.cx;
				item.tailY = s.cy;
			}
			[item.tailX, item.tailVx] = springSteps(
				item.tailX,
				item.tailVx,
				s.cx,
				170,
				22,
				dt,
			);
			[item.tailY, item.tailVy] = springSteps(
				item.tailY,
				item.tailVy,
				s.cy,
				170,
				22,
				dt,
			);
			const bi = item.blobInset ?? 0;
			const base = Math.max(4, Math.min(s.w, s.h) - bi * 2);
			const lagX = item.tailX - s.cx;
			const lagY = item.tailY - s.cy;
			const lag = Math.hypot(lagX, lagY);
			const maxLag = base * 0.8;
			if (lag > maxLag) {
				item.tailX = s.cx + (lagX / lag) * maxLag;
				item.tailY = s.cy + (lagY / lag) * maxLag;
			}
			const targetR = Math.min(
				base * (dyn.moveOpts ?? MOVE_DEFAULTS).tail,
				Math.max(0, (speed - 20) * 0.03),
			);
			item.tailR += (targetR - item.tailR) * Math.min(1, dt * 10);
			if (item.tailR < 0.3) {
				if (item.lastTail !== "hidden") {
					item.tailEl.setAttribute("r", "0");
					item.lastTail = "hidden";
				}
			} else {
				const tail = `${round(item.tailX)},${round(item.tailY)},${round(item.tailR)}`;
				if (tail !== item.lastTail) {
					item.tailEl.setAttribute("cx", String(round(item.tailX)));
					item.tailEl.setAttribute("cy", String(round(item.tailY)));
					item.tailEl.setAttribute("r", String(round(item.tailR)));
					item.lastTail = tail;
				}
			}
		}
		let renderR = Math.max(0, s.r);
		let cornerActive = false;
		if (dyn.evolve) {
			const eo = dyn.evolveOpts ?? EVOLVE_DEFAULTS;
			const now = performance.now();
			// Corner timeline: detect a morph beginning (target size starts
			// changing after a quiet spell) and run droplet-round → target radius
			// over the configured duration/easing/delay, starting at t=0 of the
			// morph — a normal animation, no motion gating.
			const prevSize = item.lastTargetSize;
			const sizeDelta = prevSize
				? Math.abs(f.w - prevSize.w) + Math.abs(f.h - prevSize.h)
				: 0;
			// LATCHED trigger: the timeline starts once per morph and cannot
			// restart until the size has been still AND the timeline has finished.
			// A gap-based test ("no size change for 120ms → new morph") restarts
			// mid-morph whenever frames are delivered irregularly — which Safari
			// does under filter repaints — and each restart snaps the corners back
			// to fully round, reading as flashing.
			if (sizeDelta > 0.5) {
				if (!item.morphActive) {
					item.cornerT0 = now;
					item.morphActive = true;
				}
				item.lastTargetMoveT = now;
			} else if (
				item.morphActive &&
				now - item.lastTargetMoveT > 150 &&
				now - item.cornerT0 > cornerTotalOf(eo)
			) {
				item.morphActive = false;
			}
			item.lastTargetSize = { w: f.w, h: f.h };
			const cornerTotal = cornerTotalOf(eo);
			let target01 = 0;
			if (
				item.cornerT0 > 0 &&
				eo.roundness > 0 &&
				now - item.cornerT0 < cornerTotal
			) {
				const p = Math.min(
					1,
					Math.max(
						0,
						(now - item.cornerT0 - Math.max(0, eo.cornerDelay)) /
							Math.max(1, eo.cornerDuration),
					),
				);
				const eased = easingFn(eo.cornerEase)(p);
				target01 = Math.min(1, Math.max(0, (1 - eased) * eo.roundness));
			}
			// Rate-limit the roundness so it GLIDES to the timeline value instead of
			// stepping: at morph start the timeline jumps to full round — invisible
			// when opening from a circle, a hard snap when closing from a card.
			const maxStep = dt * 8;
			item.round01 += Math.max(
				-maxStep,
				Math.min(maxStep, target01 - item.round01),
			);
			cornerActive =
				(item.cornerT0 > 0 && now - item.cornerT0 < cornerTotal + 80) ||
				Math.abs(target01 - item.round01) > 0.004 ||
				item.round01 > 0.004;
			if (item.round01 > 0.001) {
				// The boost may only RAISE the radius above the spring value: when the
				// size spring undershoots, min(w,h)/2 can fall below the corner radius
				// and would drag it down — that reads as the corners pulsing.
				const roundTarget = Math.max(Math.min(s.w, s.h) / 2, renderR);
				renderR = renderR + (roundTarget - renderR) * item.round01;
				// And never dip below the destination radius on the way down. (Safe
				// unconditionally: SVG clamps rx to half the rect on its own.)
				renderR = Math.max(renderR, tr);
			}
			// Content cross-blur still follows physical motion.
			const motionRaw = Math.min(
				1,
				(Math.hypot(s.vcx, s.vcy) + Math.abs(s.vw) + Math.abs(s.vh)) / 420,
			);
			item.motionEnv = Math.max(motionRaw, item.motionEnv - dt * 1.9);
			const motion = item.motionEnv;
			const blurPx = motion * motion * Math.max(0, eo.contentBlur);
			if (blurPx > 0.3) {
				item.target.style.filter = `blur(${blurPx.toFixed(1)}px)`;
				item.contentBlurred = true;
			} else if (item.contentBlurred) {
				item.target.style.removeProperty("filter");
				item.contentBlurred = false;
			}
		}
		const bi = item.blobInset ?? 0;
		const bw = Math.max(0, s.w - bi * 2);
		const bh = Math.max(0, s.h - bi * 2);
		const paint = {
			t: `translate(${s.cx - s.w / 2 + bi}px, ${s.cy - s.h / 2 + bi}px)${extra}`,
			w: String(bw),
			h: String(bh),
			rx: String(pillRadius(renderR - bi, bw, bh)),
		};
		const lp = item.lastPaint;
		if (!lp || lp.t !== paint.t) item.blob.style.transform = paint.t;
		if (!lp || lp.w !== paint.w) item.blob.setAttribute("width", paint.w);
		if (!lp || lp.h !== paint.h) item.blob.setAttribute("height", paint.h);
		if (!lp || lp.rx !== paint.rx) item.blob.setAttribute("rx", paint.rx);
		item.lastPaint = paint;
		item.last = f;
		const settled =
			Math.abs(s.cx - tcx) < 0.05 &&
			Math.abs(s.cy - tcy) < 0.05 &&
			Math.abs(s.w - f.w) < 0.05 &&
			Math.abs(s.h - f.h) < 0.05 &&
			Math.abs(s.r - tr) < 0.05 &&
			speed < 1 &&
			Math.abs(s.vw) + Math.abs(s.vh) + Math.abs(s.vr) < 1 &&
			item.motionEnv < 0.01 &&
			item.tailR < 0.3 &&
			!cornerActive;
		return !settled;
	}

	private ensureSources(): void {
		if (this.sourcesReady) return;
		const group = this.getGroup();
		if (!group) return;
		this.sourcesReady = true;
		this.mo = new MutationObserver((muts) => {
			for (const m of muts) {
				const t = m.target;
				// Ignore our own blob writes inside the silhouette SVG.
				if (!(t instanceof Element) || !t.closest("[data-gooey-svg]")) {
					this.wake();
					return;
				}
			}
		});
		this.mo.observe(group, {
			attributes: true,
			childList: true,
			subtree: true,
			attributeFilter: ["style", "class"],
		});
		const wake = () => this.wake();
		for (const type of ["transitionrun", "animationstart", "pointerdown"]) {
			group.addEventListener(type, wake, true);
			this.removeListeners.push(() =>
				group.removeEventListener(type, wake, true),
			);
		}
		window.addEventListener("scroll", wake, { capture: true, passive: true });
		this.removeListeners.push(() =>
			window.removeEventListener("scroll", wake, true),
		);
		// Safety net for motion the wake sources can't see (e.g. WAAPI):
		// a cheap silent check 3x/second while asleep.
		this.interval = setInterval(() => {
			if (!this.awake && this.measureAll()) this.wake();
		}, 300);
	}
}
