import type { Element } from "solid-js";
import { createEffect, createMemo } from "solid-js";
import type { ShadowLayer } from "../../../../../build/presentation/contracts/ShadowLayer.ts";

/** Alpha-binarize matrix used before spread dilation: the goo alpha has a soft
 *  fringe past the opaque edge — dilating it directly pushes a spread ring a
 *  pixel out and the fringe reads as a second hairline. */

/** Alpha-binarize matrix used before spread dilation: the goo alpha has a soft
 *  fringe past the opaque edge — dilating it directly pushes a spread ring a
 *  pixel out and the fringe reads as a second hairline. */

export function InsetPass(_props: { i: number; s: ShadowLayer }): Element {
	const parts = createMemo<Element[]>(() => []);
	// `bin` is computed once for the whole stack (see GooFilterPrimitives) —
	// every full-region pass costs real milliseconds on WebKit's CPU
	// rasterizer, and each pass here used to re-binarize `shape` identically.
	let src = "bin";
	// Erode by the SPREAD only. An offset-only inset (`inset 0 1px 0 0`) must
	// leave a 1px strip along the TOP edge and nothing else — eroding for it
	// too shrinks the shape all round and paints a spurious ring on the sides
	// and bottom, doubling up with a real inner ring in the same stack.
	createEffect(
		() => [_props.s, parts(), _props.i],
		() => {
			if (_props.s.spread !== 0) {
				parts().push(
					<feMorphology
						in={src}
						operator={_props.s.spread > 0 ? "erode" : "dilate"}
						radius={Math.abs(_props.s.spread)}
						result={`s${_props.i}-er`}
					/>,
				);
				src = `s${_props.i}-er`;
			}
		},
	);
	createEffect(
		() => [_props.s, parts(), _props.i],
		() => {
			if (_props.s.x !== 0 || _props.s.y !== 0) {
				parts().push(
					<feOffset
						in={src}
						dx={_props.s.x}
						dy={_props.s.y}
						result={`s${_props.i}-o`}
					/>,
				);
				src = `s${_props.i}-o`;
			}
		},
	);
	createEffect(
		() => [_props.s, parts(), _props.i],
		() => {
			if (_props.s.blur > 0) {
				parts().push(
					<feGaussianBlur
						in={src}
						stdDeviation={_props.s.blur / 2}
						result={`s${_props.i}-b`}
					/>,
				);
				src = `s${_props.i}-b`;
			}
		},
	);
	parts().push(
		// The band: silhouette minus its shrunk/offset self.
		<feComposite
			in="bin"
			in2={src}
			operator="out"
			result={`s${_props.i}-band`}
		/>,
		<feFlood flood-color={_props.s.color} result={`s${_props.i}-c`} />,
		<feComposite
			in={`s${_props.i}-c`}
			in2={`s${_props.i}-band`}
			operator="in"
			result={`s${_props.i}`}
		/>,
	);
	return <>{parts()}</>;
}
