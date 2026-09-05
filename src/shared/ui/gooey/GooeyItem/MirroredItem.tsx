import { createPortal, useMemo, useRef, useState } from "octane";
import type { CSSProperties } from "../../../../types/octane-react-compat.ts";
import {
	type BlobBox,
	type CornerRadii,
	measureRadius,
	normalizeRadius,
	offsetTo,
	roundedRectPath,
} from "../geometry";
import { useIsoLayoutEffect, useReducedMotion } from "../hooks";
import { easingFunction, resolveTransition, type Transition } from "../spring";
import type { Internal } from "./shared.ts";
import * as inlineStyles from "./styles.ts";

function transitionKey(t: Transition | undefined): string {
	return typeof t === "string" ? t : JSON.stringify(t ?? null);
}

function sameBox(a: BlobBox | null, b: BlobBox): boolean {
	return (
		!!a &&
		a.x === b.x &&
		a.y === b.y &&
		a.w === b.w &&
		a.h === b.h &&
		a.r.every((v, i) => v === b.r[i])
	);
}

export function MirroredItem({
	x = 0,
	y = 0,
	scale = 1,
	transition = "smooth",
	delay = 0,
	radius,
	className,
	style,
	children,
	ctx,
}: Internal) {
	const wrapRef = useRef<HTMLDivElement | null>(null);
	const blobRef = useRef<SVGGraphicsElement | null>(null);
	const [box, setBox] = useState<BlobBox | null>(null);
	const reduced = useReducedMotion();

	const tKey = transitionKey(transition);
	const { duration, easing } = useMemo(
		() => resolveTransition(transition, reduced),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[tKey, reduced],
	);

	const radiusKey = radius == null ? "" : JSON.stringify(radius);
	useIsoLayoutEffect(() => {
		const el = wrapRef.current;
		const group = ctx.getGroup();
		if (!el || !group) return;
		const measure = () => {
			const base = offsetTo(el, group);
			const w = el.offsetWidth;
			const h = el.offsetHeight;
			const target = (el.firstElementChild as HTMLElement | null) ?? el;
			const r: CornerRadii =
				radius != null ? normalizeRadius(radius) : measureRadius(target, w, h);
			const next: BlobBox = { x: base.x, y: base.y, w, h, r };
			setBox((prev) => (sameBox(prev, next) ? prev : next));
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		ro.observe(group);
		return () => ro.disconnect();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ctx, radiusKey]);

	// Content and blob are animated by ONE JS clock — no CSS transition on the
	// wrapper. A compositor transition keeps playing through a main-thread
	// stall while the blob (always written from JS) freezes; under Safari's
	// SVG-filter load that read as icons and photos sailing away from their own
	// liquid. With both written in the same rAF tick from the same easing
	// curve, they can only ever move together: a stall holds the whole
	// ensemble, which reads as a hitch, never a tear. The curve is identical to
	// the CSS one (same duration/easing via easingFunction), so browsers that
	// never stall render exactly what they did before.
	const cur = useRef<{ x: number; y: number; s: number } | null>(null);
	const writeTransform = (px: number, py: number, ps: number) => {
		const t = `translate(${px}px, ${py}px)` + (ps !== 1 ? ` scale(${ps})` : "");
		if (wrapRef.current) wrapRef.current.style.transform = t;
		if (blobRef.current) blobRef.current.style.transform = t;
	};
	useIsoLayoutEffect(() => {
		const from = cur.current;
		if (
			!from ||
			duration <= 0 ||
			(from.x === x && from.y === y && from.s === scale)
		) {
			cur.current = { x, y, s: scale };
			writeTransform(x, y, scale);
			return;
		}
		// Retarget like a CSS transition: from the currently rendered value, full
		// duration. `delay` holds at the start value first (stagger).
		const f = { ...from };
		const ease = easingFunction(easing);
		const start = performance.now() + delay;
		let raf = 0;
		const tick = (now: number) => {
			const p = Math.min(1, Math.max(0, (now - start) / duration));
			const e = ease(p);
			const cx = f.x + (x - f.x) * e;
			const cy = f.y + (y - f.y) * e;
			const cs = f.s + (scale - f.s) * e;
			cur.current = { x: cx, y: cy, s: cs };
			writeTransform(cx, cy, cs);
			if (p < 1) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [x, y, scale, duration, easing, delay]);

	return (
		<>
			<div
				ref={wrapRef}
				className={className}
				style={inlineStyles.getMirroredItemDivStyle(style)}
			>
				{children}
			</div>
			{ctx.portal &&
				box &&
				createPortal(
					renderBlob(
						box,
						{
							transformBox: "fill-box",
							transformOrigin: "center",
							willChange: "transform",
						},
						(el) => {
							blobRef.current = el;
							// The blob (re)mounts whenever the measured box changes; catch
							// it up to the currently rendered value immediately.
							if (el) {
								const c = cur.current ?? { x, y, s: scale };
								el.style.transform =
									`translate(${c.x}px, ${c.y}px)` +
									(c.s !== 1 ? ` scale(${c.s})` : "");
							}
						},
					),
					ctx.portal,
				)}
		</>
	);
}

function renderBlob(
	box: BlobBox,
	style: CSSProperties,
	setRef: (el: SVGGraphicsElement | null) => void,
) {
	const [tl, tr, br, bl] = box.r;
	const uniform = tl === tr && tr === br && br === bl;
	if (uniform) {
		// Clamp to min(w,h)/2: SVG clamps rx and ry independently, so a large
		// radius on a wide short box (the `border-radius: 999px` pill idiom)
		// would degenerate into an ellipse instead of a pill.
		const rx = Math.max(0, Math.min(tl, Math.min(box.w, box.h) / 2));
		return (
			<rect
				ref={setRef}
				x={box.x}
				y={box.y}
				width={box.w}
				height={box.h}
				rx={rx}
				style={style}
			/>
		);
	}
	return (
		<path
			ref={setRef}
			d={roundedRectPath(box.x, box.y, box.w, box.h, box.r)}
			style={style}
		/>
	);
}
