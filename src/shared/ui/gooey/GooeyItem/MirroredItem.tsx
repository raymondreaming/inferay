import { Portal } from "@solidjs/web";
import { createEffect, createMemo, createSignal } from "solid-js";
import { type CSSProperties, domStyle } from "../../../lib/dom.tsx";
import { rounded_rect } from "../../../lib/native.tsx";
import {
	type CornerRadii,
	measureRadius,
	normalizeRadius,
} from "../Gooey/index.tsx";
import type { Internal } from "./index.tsx";
import * as inlineStyles from "./styles.ts";

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
export function MirroredItem(_props: Internal) {
	const wrapRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const [box, setBox] = createSignal<BlobBox | null>(null);
	const radiusKey = createMemo(() =>
		_props.radius == null ? "" : JSON.stringify(_props.radius),
	);
	createEffect(
		() => [_props.ctx, radiusKey()],
		() => {
			const el = wrapRef.current;
			const group = _props.ctx.getGroup();
			if (!el || !group) return;
			const measure = () => {
				const base = offsetTo(el, group);
				const w = el.offsetWidth;
				const h = el.offsetHeight;
				const target = (el.firstElementChild as HTMLElement | null) ?? el;
				const r: CornerRadii =
					_props.radius != null
						? normalizeRadius(_props.radius)
						: measureRadius(target, w, h);
				const next: BlobBox = {
					x: base.x,
					y: base.y,
					w,
					h,
					r,
				};
				setBox((prev) => (sameBox(prev, next) ? prev : next));
			};
			measure();
			const ro = new ResizeObserver(measure);
			ro.observe(el);
			ro.observe(group);
			return () => ro.disconnect();
		},
	);
	return (
		<>
			<div
				ref={(element) => (wrapRef.current = element)}
				class={_props.class}
				style={domStyle(inlineStyles.getMirroredItemDivStyle(_props.style))}
			>
				{_props.children}
			</div>
			{_props.ctx.portal && box() && (
				<Portal mount={_props.ctx.portal}>
					{renderBlob(box()!, inlineStyles.mirroredBlobStyle)}
				</Portal>
			)}
		</>
	);
}
function renderBlob(box: BlobBox, style: CSSProperties) {
	const _source = createMemo(() => box.r);
	const uniform = createMemo(() => {
		const _sourceValue = _source();
		return (
			_sourceValue[0] === _sourceValue[1] &&
			_sourceValue[1] === _sourceValue[2] &&
			_sourceValue[2] === _sourceValue[3]
		);
	});
	if (uniform()) {
		// Clamp to min(w,h)/2: SVG clamps rx and ry independently, so a large
		// radius on a wide short box (the `border-radius: 999px` pill idiom)
		// would degenerate into an ellipse instead of a pill.
		const rx = Math.max(0, Math.min(_source()[0], Math.min(box.w, box.h) / 2));
		return (
			<rect
				x={box.x}
				y={box.y}
				width={box.w}
				height={box.h}
				rx={rx}
				style={domStyle(style)}
			/>
		);
	}
	return (
		<path
			d={rounded_rect(box.x, box.y, box.w, box.h, ...box.r)}
			style={domStyle(style)}
		/>
	);
}
interface BlobBox {
	x: number;
	y: number;
	w: number;
	h: number;
	r: CornerRadii;
}

/** Transform-free position of `el` relative to `ancestor` via the offsetParent
 *  chain — the blob mirrors motion separately, so its base box must ignore the
 *  transform currently applied to the wrapper. */
function offsetTo(
	el: HTMLElement,
	ancestor: HTMLElement,
): {
	x: number;
	y: number;
} {
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
