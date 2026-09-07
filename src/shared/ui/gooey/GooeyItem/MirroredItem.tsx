import { Portal } from "@solidjs/web";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
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
		() => [_props.ctx.getGroup, radiusKey()] as const,
		([getGroup, radius]) => {
			const el = wrapRef.current;
			const group = getGroup();
			if (!el || !group) return;
			const measure = () => {
				const base = offsetTo(el, group);
				const w = el.offsetWidth;
				const h = el.offsetHeight;
				const target = (el.firstElementChild as HTMLElement | null) ?? el;
				const r: CornerRadii = radius
					? normalizeRadius(JSON.parse(radius))
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
			<Show when={_props.ctx.portal}>
				{(mount) => (
					<Portal mount={mount()}>
						<Show when={box()}>
							{(current) => (
								<MirroredBlob
									box={current()}
									style={inlineStyles.mirroredBlobStyle}
								/>
							)}
						</Show>
					</Portal>
				)}
			</Show>
		</>
	);
}
function MirroredBlob(props: { box: BlobBox; style: CSSProperties }) {
	const uniform = createMemo(() =>
		props.box.r.every((radius) => radius === props.box.r[0]),
	);
	const radius = createMemo(() =>
		Math.max(
			0,
			Math.min(props.box.r[0], Math.min(props.box.w, props.box.h) / 2),
		),
	);
	return (
		<Show
			when={uniform()}
			fallback={
				<path
					d={rounded_rect(
						props.box.x,
						props.box.y,
						props.box.w,
						props.box.h,
						...props.box.r,
					)}
					style={domStyle(props.style)}
				/>
			}
		>
			<rect
				x={props.box.x}
				y={props.box.y}
				width={props.box.w}
				height={props.box.h}
				rx={radius()}
				style={domStyle(props.style)}
			/>
		</Show>
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
