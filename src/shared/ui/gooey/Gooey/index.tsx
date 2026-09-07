import type { JSX } from "@solidjs/web";
import type { Ref } from "solid-js";
import {
	createContext,
	createEffect,
	createMemo,
	createSignal,
	createUniqueId,
	omit,
	onSettled,
	useContext,
} from "solid-js";
import { assignRef, type CSSProperties, domStyle } from "../../../lib/dom.tsx";
import { GooFilterPrimitives } from "../filter/index.tsx";

import * as inlineStyles from "./styles.ts";
export interface GooeyProps
	extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "style" | "ref"> {
	ref?: Ref<HTMLDivElement>;
	style?: CSSProperties;
	/** Goo blur sigma in px — how far apart pieces start bridging. Default 6. */
	blur?: number;
	/** Alpha-contrast slope — how sharp the liquid edge is. Default 18. */
	contrast?: number;
	/** Fill of the liquid surface. Any CSS color, `var()` welcome. Default '#fff'. */
	fill?: string;
	/** `box-shadow` syntax; rendered on the MERGED silhouette. `inset` layers
	 *  paint inside the liquid edge (inner rings / top highlights). */
	shadow?: string;
	/** Extra filter-region slack in px for blobs travelling outside the group box. Default 24. */
	filterPadding?: number;
}
export function GooeyRoot(_props: GooeyProps) {
	const groupRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const [portal, setPortal] = createSignal<SVGGElement | null>(null);
	const [size, setSize] = createSignal({
		w: 0,
		h: 0,
	});
	const setRefs = (node: HTMLDivElement) => {
		groupRef.current = node;
		assignRef(_props.ref, node);
	};
	const filterId = `gooey-${createUniqueId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
	const shadows = createMemo(() => parseShadow(_props.shadow));
	onSettled(() => {
		const el = groupRef.current;
		if (!el) return;
		const measure = () =>
			setSize((prev) =>
				prev.w === el.offsetWidth && prev.h === el.offsetHeight
					? prev
					: {
							w: el.offsetWidth,
							h: el.offsetHeight,
						},
			);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	});
	const engine = new ObserveEngine(() => groupRef.current);
	onSettled(() => () => engine.dispose());
	createEffect(
		() => _props.blur ?? 6,
		(blur) => {
			engine.gooBlur = blur;
		},
	);
	// Context identity is fixed; consumers track individual reactive fields.
	const ctx: GooeyContextValue = {
		get portal() {
			return portal();
		},
		get fill() {
			return _props.fill ?? "#fff";
		},
		getGroup: () => groupRef.current,
		engine,
	};

	// The filter raster is the whole performance story on WebKit, which runs
	// SVG filters on the CPU at full device scale — measured at 9fps for a
	// drag on an iPhone-class 3x screen. The heavy layers are the BLURRED
	// outer shadows: a 42px-blur pass re-rasterises the entire padded region
	// every animated frame. CSS drop-shadow() is mathematically the same
	// operation (blur-radius = 2σ, exactly box-shadow's convention, exactly
	// the stdDeviation = blur/2 the SVG pass used) — but a CSS filter list on
	// the element runs on the COMPOSITOR, GPU-accelerated in both WebKit and
	// Chromium. So the stack is split:
	//   - blurred/offset outer shadows  -> drop-shadow() on the svg element
	//   - spread rings and inset layers -> SVG passes (not expressible in
	//     CSS, but they are morphology/offset ops with no big blurs — cheap)
	//   - the goo chain itself          -> SVG, as before
	// One spec'd difference: chained drop-shadows each see the previous
	// result, so a later shadow also shadows an earlier one's pixels — at the
	// 5-25% alphas shadows use, that cross-term is under 1% alpha, invisible.
	// The filter pad also shrinks to what the REMAINING svg layers reach,
	// which cuts the rasterised area again.
	const svgShadows = createMemo(() =>
		shadows().filter((s) => s.inset || s.spread !== 0),
	);
	const cssShadowFilter = createMemo(() =>
		shadows()
			.filter((s) => !s.inset && s.spread === 0)
			// box-shadow lists paint the FIRST layer on top; drop-shadow chains
			// paint later filters behind earlier output, so document order already
			// matches.
			.map((s) => `drop-shadow(${s.x}px ${s.y}px ${s.blur}px ${s.color})`)
			.join(" "),
	);
	const shadowExtent = createMemo(() =>
		svgShadows().reduce(
			(m, s) =>
				Math.max(
					m,
					Math.max(Math.abs(s.x), Math.abs(s.y)) +
						s.blur * 1.5 +
						Math.max(0, s.spread),
				),
			0,
		),
	);
	const pad = createMemo(() =>
		Math.ceil(
			(_props.blur === undefined ? 6 : _props.blur) * 3 +
				shadowExtent() +
				(_props.filterPadding === undefined ? 24 : _props.filterPadding),
		),
	);
	return (
		<div
			{...omit(
				_props,
				"blur",
				"contrast",
				"fill",
				"shadow",
				"filterPadding",
				"class",
				"style",
				"children",
				"ref",
			)}
			ref={(_element) => assignRef(setRefs, _element)}
			class={_props.class}
			style={domStyle(inlineStyles.getGooeyRootDivStyle(_props.style))}
		>
			{/* zIndex -1 inside the isolated group: the liquid paints above the
          group's own background but below every child, positioned or not. */}
			<svg
				aria-hidden="true"
				data-gooey-svg=""
				style={domStyle(
					inlineStyles.getGooeyRootSvgStyle(cssShadowFilter() || undefined),
				)}
			>
				<defs>
					<filter
						id={filterId}
						filterUnits="userSpaceOnUse"
						x={-pad()}
						y={-pad()}
						width={size().w + pad() * 2}
						height={size().h + pad() * 2}
						color-interpolation-filters="sRGB"
					>
						<GooFilterPrimitives
							blur={_props.blur === undefined ? 6 : _props.blur}
							contrast={_props.contrast === undefined ? 18 : _props.contrast}
							shadows={svgShadows()}
						/>
					</filter>
				</defs>
				<g
					id={`${filterId}-sil`}
					ref={(_element2) => assignRef(setPortal, _element2)}
					filter={`url(#${filterId})`}
					style={domStyle(
						inlineStyles.getGooeyRootGStyle(
							_props.fill === undefined ? "#fff" : _props.fill,
						),
					)}
				/>
			</svg>
			<GooeyContext value={ctx}>{_props.children}</GooeyContext>
		</div>
	);
}
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

import type { EvolveOptions } from "../../../../../build/presentation/contracts/EvolveOptions.ts";
import type { LiquidFrame } from "../../../../../build/presentation/contracts/LiquidFrame.ts";
import type { MoveOptions } from "../../../../../build/presentation/contracts/MoveOptions.ts";
import type { ShadowLayer } from "../../../../../build/presentation/contracts/ShadowLayer.ts";
import liquidDefaults from "../../../../../build/presentation/liquid-defaults.json";
import {
	LiquidBody,
	LiquidGroup,
	project as rustProject,
} from "../../../lib/native.tsx";
export type CornerRadii = [number, number, number, number];
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
export const EVOLVE_DEFAULTS: Required<EvolveOptions> = liquidDefaults.evolve;
export const MOVE_DEFAULTS: Required<MoveOptions> = liquidDefaults.move;
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
interface Item extends ObservedTarget {
	baseW: number;
	radiusPx: number;
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
	lastPaint: LiquidFrame["paint"] | null;
	/** Last tail-circle write ('hidden' when parked at r=0), same reason. */
	lastTail: string | null;
	ro: ResizeObserver;
}
const SVG_NS = "http://www.w3.org/2000/svg";
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
 *  animation events + a slow safety tick wake it. Empty groups stop all sources.
 */
export class ObserveEngine {
	/** Goo blur of the owning group; used to derive the bridge-growth range. */
	gooBlur = 6;
	private items = new Set<Item>();
	private geometry: LiquidGroup | null = null;
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
			radiusPx: this.resolveRadius(t),
			frame: null,
			body: new LiquidBody(),
			tailEl: null,
			contentBlurred: false,
			lastPaint: null,
			lastTail: null,
			ro: new ResizeObserver(() => {
				item.baseW = t.target.offsetWidth || 1;
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
		return () => this.removeItem(item);
	}
	private removeItem(item: Item): void {
		// Owner and child cleanups may arrive in either order.
		if (!this.items.delete(item)) return;
		item.ro.disconnect();
		item.body.free();
		if (item.contentBlurred) item.target.style.removeProperty("filter");
		item.tailEl?.remove();
		if (this.items.size === 0) this.stopSources();
	}

	wake = (): void => {
		this.clean = 0;
		if (this.awake || this.items.size === 0) return;
		this.awake = true;
		this.raf = requestAnimationFrame(this.loop);
	};
	dispose(): void {
		for (const item of this.items) this.removeItem(item);
		this.stopSources();
		this.geometry?.free();
		this.geometry = null;
	}
	private stopSources(): void {
		cancelAnimationFrame(this.raf);
		this.raf = 0;
		this.mo?.disconnect();
		this.mo = null;
		for (const off of this.removeListeners) off();
		this.removeListeners = [];
		if (this.interval !== null) clearInterval(this.interval);
		this.interval = null;
		this.awake = false;
		this.clean = 0;
		this.lastNow = 0;
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
		const coordinates = new Float64Array(this.items.size * 4);
		let index = 0;
		// Read all neighbour geometry before writing any blob attributes.
		for (const item of this.items) {
			const r = item.target.getBoundingClientRect();
			coordinates.set(
				[r.left - g.left, r.top - g.top, r.width, r.height],
				index++ * 4,
			);
			item.frame = {
				x: r.left - g.left,
				y: r.top - g.top,
				w: r.width,
				h: r.height,
			};
		}
		this.geometry ??= new LiquidGroup();
		const geometry = this.geometry;
		geometry.measure(coordinates);
		index = 0;
		for (const item of this.items) {
			if (this.writeBlob(item, dt, geometry, index++)) changed = true;
		}
		return changed;
	}
	private writeBlob(
		item: Item,
		dt: number,
		geometry: LiquidGroup,
		index: number,
	): boolean {
		const f = item.frame!;
		const dyn = item.dynamics;
		if (!dyn || (!dyn.evolve && !dyn.move)) {
			const paint = item.body.observe(
				geometry,
				index,
				new Float64Array([
					item.baseW,
					item.radiusPx,
					item.blobInset ?? 0,
					item.bridgeGrow ?? 0,
					this.gooBlur,
					dt,
				]),
			);
			if (!paint.length) return false;
			item.blob.style.transform = `translate(${paint[0]}px, ${paint[1]}px)`;
			item.blob.setAttribute("width", String(paint[2]));
			item.blob.setAttribute("height", String(paint[3]));
			item.blob.setAttribute("rx", String(paint[4]));
			item.lastPaint = null;
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
		) as LiquidFrame;
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
export function parseShadow(input?: string | null): ShadowLayer[] {
	return rustProject("shadowLayers", input ?? "");
}
