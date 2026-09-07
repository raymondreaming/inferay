import type { EvolveOptions as NativeEvolveOptions } from "../../../../build/presentation/contracts/EvolveOptions.ts";
import type { MoveOptions as NativeMoveOptions } from "../../../../build/presentation/contracts/MoveOptions.ts";
import {
	ease,
	LiquidBody,
	rounded_rect,
} from "../../../adapters/presentation/model.ts";
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

import { lazy } from "octane";
export const LazyLiquidPanelSurface = lazy(() =>
	import("./LiquidPanelSurface/index.tsx").then((module) => ({
		default: module.LiquidPanelSurface,
	})),
);

import { createContext, useContext } from "octane";
export interface GooeyContextValue {
	portal: SVGGElement | null;
	/** The group's liquid fill — default colour of the intruding mix liquid. */
	fill: string;
	getGroup: () => HTMLDivElement | null;
	engine: ObserveEngine;
}
export const GooeyContext = createContext<GooeyContextValue | null>(null);
export function useGooeyContext(): GooeyContextValue {
	const ctx = useContext(GooeyContext);
	if (!ctx)
		throw new Error("<Gooey.Item> must be rendered inside a <Gooey> group.");
	return ctx;
}
export type CornerRadii = [number, number, number, number];
export interface BlobBox {
	x: number;
	y: number;
	w: number;
	h: number;
	r: CornerRadii;
}

/** Transform-free position of `el` relative to `ancestor` via the offsetParent
 *  chain — the blob mirrors motion separately, so its base box must ignore the
 *  transform currently applied to the wrapper. */
export function offsetTo(
	el: HTMLElement,
	ancestor: HTMLElement,
): { x: number; y: number } {
	let x = 0;
	let y = 0;
	let node: HTMLElement | null = el;
	while (node && node !== ancestor && ancestor.contains(node)) {
		x += node.offsetLeft;
		y += node.offsetTop;
		node = node.offsetParent as HTMLElement | null;
	}
	return {
		x,
		y,
	};
}
export function measureRadius(el: Element, w: number, h: number): CornerRadii {
	const cs = getComputedStyle(el);
	const parse = (v: string): number => {
		const first = v.split(" ")[0];
		if (first.endsWith("%"))
			return ((parseFloat(first) || 0) / 100) * Math.min(w, h);
		return parseFloat(first) || 0;
	};
	return [
		parse(cs.borderTopLeftRadius),
		parse(cs.borderTopRightRadius),
		parse(cs.borderBottomRightRadius),
		parse(cs.borderBottomLeftRadius),
	];
}
export function normalizeRadius(r: number | CornerRadii): CornerRadii {
	return typeof r === "number" ? [r, r, r, r] : r;
}

/** Rounded-rect path with per-corner radii, CSS-style overlap clamping. */
export function roundedRectPath(
	x: number,
	y: number,
	w: number,
	h: number,
	radii: CornerRadii,
): string {
	return rounded_rect(x, y, w, h, ...radii);
}

import { useEffect, useLayoutEffect } from "octane";
export const useIsoLayoutEffect =
	typeof window !== "undefined" ? useLayoutEffect : useEffect;
/** Evaluate timing curves used by the observed liquid shape animation. */
export function easingFunction(spec: string): (t: number) => number {
	return (t) => ease(spec, t);
}
export type EvolveOptions = Partial<NativeEvolveOptions>;
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

export type MoveOptions = Partial<NativeMoveOptions>;
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

/** Clamp a CSS corner radius for use as an SVG rect `rx`.
 *
 *  SVG clamps `rx` to w/2 and `ry` (defaulted from rx) to h/2 INDEPENDENTLY,
 *  so a large radius on a wide short box — the `border-radius: 999px` pill
 *  idiom — degenerates into an ellipse. Clamping to min(w,h)/2 keeps it a
 *  true pill, matching how CSS renders the same value. */
function pillRadius(r: number, w: number, h: number): number {
	return Math.max(0, Math.min(r, Math.min(w, h) / 2));
}

interface Item extends ObservedTarget {
	baseW: number;
	baseH: number;
	radiusPx: number;
	last: Frame | null;
	frame: Frame | null;
	body: LiquidBody;
	tailEl: SVGCircleElement | null;
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
			body: new LiquidBody(),
			tailEl: null,
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
			const tail = svg("circle", {
				cx: "0",
				cy: "0",
				r: "0",
			});
			t.blob.parentNode?.insertBefore(tail, t.blob);
			item.tailEl = tail;
		}
		this.ensureSources();
		this.measureAll();
		this.wake();
		return () => {
			item.ro.disconnect();
			this.items.delete(item);
			item.body.free();
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
			i.body.free();
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

		const radius = dyn.evolve
			? measureRadius(
					item.target,
					item.target.offsetWidth,
					item.target.offsetHeight,
				)[0]
			: item.radiusPx * (item.baseW > 0 ? f.w / item.baseW : 1);
		const { paint, tail, blur, settled } = JSON.parse(
			item.body.tick(
				JSON.stringify({
					frame: f,
					dt,
					now: performance.now(),
					radius,
					inset: item.blobInset ?? 0,
					dynamics: dyn,
				}),
			),
		) as {
			paint: NonNullable<Item["lastPaint"]>;
			tail: [number, number, number] | null;
			blur: string | null;
			settled: boolean;
		};
		if (tail && item.tailEl) {
			const key = tail[2] === 0 ? "hidden" : tail.join(",");
			if (key !== item.lastTail) {
				item.tailEl.setAttribute("cx", String(tail[0]));
				item.tailEl.setAttribute("cy", String(tail[1]));
				item.tailEl.setAttribute("r", String(tail[2]));
				item.lastTail = key;
			}
		}
		if (dyn.evolve) {
			if (blur) item.target.style.filter = blur;
			else if (item.contentBlurred) item.target.style.removeProperty("filter");
			item.contentBlurred = blur !== null;
		}
		const lp = item.lastPaint;
		if (!lp || lp.t !== paint.t) item.blob.style.transform = paint.t;
		if (!lp || lp.w !== paint.w) item.blob.setAttribute("width", paint.w);
		if (!lp || lp.h !== paint.h) item.blob.setAttribute("height", paint.h);
		if (!lp || lp.rx !== paint.rx) item.blob.setAttribute("rx", paint.rx);
		item.lastPaint = paint;
		item.last = f;
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
		window.addEventListener("scroll", wake, {
			capture: true,
			passive: true,
		});
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

import type { GooeyProps } from "./Gooey/index.tsx";
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
/** `box-shadow`-syntax parser. Layers become SVG filter passes built from the
 *  merged liquid silhouette, so one shadow hugs the goo through every state. */

export interface ShadowLayer {
	x: number;
	y: number;
	blur: number;
	spread: number;
	color: string;
	/** Inner shadow/highlight: painted INSIDE the liquid edge, following the
	 *  merged silhouette exactly like the outer passes. */
	inset: boolean;
}
function splitTop(s: string, sep: "," | " "): string[] {
	const parts: string[] = [];
	let depth = 0;
	let cur = "";
	for (const ch of s) {
		if (ch === "(") depth++;
		else if (ch === ")") depth--;
		if (depth === 0 && (sep === "," ? ch === "," : /\s/.test(ch))) {
			if (cur.trim()) parts.push(cur.trim());
			cur = "";
		} else {
			cur += ch;
		}
	}
	if (cur.trim()) parts.push(cur.trim());
	return parts;
}
const LENGTH = /^[+-]?(\d+\.?\d*|\.\d+)(px)?$/;
export function parseShadow(input?: string | null): ShadowLayer[] {
	if (!input || input.trim() === "" || input.trim() === "none") return [];
	const out: ShadowLayer[] = [];
	for (const layer of splitTop(input, ",")) {
		const tokens = splitTop(layer, " ");
		if (tokens.length === 0) continue;
		const inset = tokens.includes("inset");
		const nums: number[] = [];
		const colorParts: string[] = [];
		for (const tok of tokens) {
			if (tok === "inset") continue;
			if (nums.length < 4 && LENGTH.test(tok)) nums.push(parseFloat(tok));
			else colorParts.push(tok);
		}
		const [x = 0, y = 0, blur = 0, spread = 0] = nums;
		out.push({
			x,
			y,
			blur,
			spread,
			color: colorParts.join(" ") || "rgba(0, 0, 0, 0.35)",
			inset,
		});
	}
	return out;
}

import type { OctaneNode } from "octane";
import type { Octane, OctaneElement } from "octane/jsx-runtime";
import type * as ReactTypes from "react";

/** Type-only aliases used by the vendored Gooey source. Runtime behavior is
 * entirely Octane-native. */
export type ReactNode = OctaneNode;
export type ReactElement<P = any> = OctaneElement<P>;
export type CSSProperties = ReactTypes.CSSProperties;
export type Ref<T> = Octane.Ref<T>;
