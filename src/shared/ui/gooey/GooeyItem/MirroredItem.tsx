import { createPortal, useRef, useState } from "octane";
import type { CSSProperties } from "../../../../types/octane-react-compat.ts";
import {
	type BlobBox,
	type CornerRadii,
	measureRadius,
	normalizeRadius,
	offsetTo,
	roundedRectPath,
} from "../geometry";
import { useIsoLayoutEffect } from "../hooks";
import type { Internal } from "./shared.ts";
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

export function MirroredItem({
	radius,
	className,
	style,
	children,
	ctx,
}: Internal) {
	const wrapRef = useRef<HTMLDivElement | null>(null);
	const [box, setBox] = useState<BlobBox | null>(null);
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
					renderBlob(box, inlineStyles.mirroredBlobStyle),
					ctx.portal,
				)}
		</>
	);
}

function renderBlob(box: BlobBox, style: CSSProperties) {
	const [tl, tr, br, bl] = box.r;
	const uniform = tl === tr && tr === br && br === bl;
	if (uniform) {
		// Clamp to min(w,h)/2: SVG clamps rx and ry independently, so a large
		// radius on a wide short box (the `border-radius: 999px` pill idiom)
		// would degenerate into an ellipse instead of a pill.
		const rx = Math.max(0, Math.min(tl, Math.min(box.w, box.h) / 2));
		return (
			<rect
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
			d={roundedRectPath(box.x, box.y, box.w, box.h, box.r)}
			style={style}
		/>
	);
}
