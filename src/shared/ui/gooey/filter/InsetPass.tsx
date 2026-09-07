import { createMemo, Show } from "solid-js";
import type { ShadowLayer } from "../../../../../build/presentation/contracts/ShadowLayer.ts";

/** Erode only for spread; an offset-only inset must leave just its edge strip. */
export function InsetPass(props: { i: number; s: ShadowLayer }) {
	const spreadSource = createMemo(() =>
		props.s.spread !== 0 ? `s${props.i}-er` : "bin",
	);
	const offset = createMemo(() => props.s.x !== 0 || props.s.y !== 0);
	const offsetSource = createMemo(() =>
		offset() ? `s${props.i}-o` : spreadSource(),
	);
	const source = createMemo(() =>
		props.s.blur > 0 ? `s${props.i}-b` : offsetSource(),
	);
	return (
		<>
			<Show when={props.s.spread !== 0}>
				<feMorphology
					in="bin"
					operator={props.s.spread > 0 ? "erode" : "dilate"}
					radius={Math.abs(props.s.spread)}
					result={`s${props.i}-er`}
				/>
			</Show>
			<Show when={offset()}>
				<feOffset
					in={spreadSource()}
					dx={props.s.x}
					dy={props.s.y}
					result={`s${props.i}-o`}
				/>
			</Show>
			<Show when={props.s.blur > 0}>
				<feGaussianBlur
					in={offsetSource()}
					stdDeviation={props.s.blur / 2}
					result={`s${props.i}-b`}
				/>
			</Show>
			<feComposite
				in="bin"
				in2={source()}
				operator="out"
				result={`s${props.i}-band`}
			/>
			<feFlood flood-color={props.s.color} result={`s${props.i}-c`} />
			<feComposite
				in={`s${props.i}-c`}
				in2={`s${props.i}-band`}
				operator="in"
				result={`s${props.i}`}
			/>
		</>
	);
}
