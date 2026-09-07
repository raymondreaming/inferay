import type { Element } from "solid-js";
import { createEffect, createMemo } from "solid-js";
import type { ShadowLayer } from "../../../../../build/presentation/contracts/ShadowLayer.ts";

/** Alpha-binarize matrix used before spread dilation: the goo alpha has a soft
 *  fringe past the opaque edge — dilating it directly pushes a spread ring a
 *  pixel out and the fringe reads as a second hairline. */

/** Alpha-binarize matrix used before spread dilation: the goo alpha has a soft
 *  fringe past the opaque edge — dilating it directly pushes a spread ring a
 *  pixel out and the fringe reads as a second hairline. */

export function ShadowPass(_props: { i: number; s: ShadowLayer }): Element {
	const parts = createMemo<Element[]>(() => []);
	let src = "shape";
	createEffect(
		() => [_props.s, parts(), _props.i],
		() => {
			if (_props.s.spread !== 0) {
				parts().push(
					<feMorphology
						in="bin"
						operator={_props.s.spread > 0 ? "dilate" : "erode"}
						radius={Math.abs(_props.s.spread)}
						result={`s${_props.i}-sp`}
					/>,
				);
				src = `s${_props.i}-sp`;
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
	parts().push(
		<feFlood flood-color={_props.s.color} result={`s${_props.i}-c`} />,
		<feComposite
			in={`s${_props.i}-c`}
			in2={src}
			operator="in"
			result={`s${_props.i}`}
		/>,
	);
	return <>{parts()}</>;
}
