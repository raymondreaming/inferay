import { createMemo, Show } from "solid-js";
import type { ShadowLayer } from "../../../../../build/presentation/contracts/ShadowLayer.ts";

/** Keep the SVG dependency chain declarative as shadow properties change. */
export function ShadowPass(props: { i: number; s: ShadowLayer }) {
	const spreadSource = createMemo(() =>
		props.s.spread !== 0 ? `s${props.i}-sp` : "shape",
	);
	const blurSource = createMemo(() =>
		props.s.blur > 0 ? `s${props.i}-b` : spreadSource(),
	);
	const offset = createMemo(() => props.s.x !== 0 || props.s.y !== 0);
	const source = createMemo(() => (offset() ? `s${props.i}-o` : blurSource()));
	return (
		<>
			<Show when={props.s.spread !== 0}>
				<feMorphology
					in="bin"
					operator={props.s.spread > 0 ? "dilate" : "erode"}
					radius={Math.abs(props.s.spread)}
					result={`s${props.i}-sp`}
				/>
			</Show>
			<Show when={props.s.blur > 0}>
				<feGaussianBlur
					in={spreadSource()}
					stdDeviation={props.s.blur / 2}
					result={`s${props.i}-b`}
				/>
			</Show>
			<Show when={offset()}>
				<feOffset
					in={blurSource()}
					dx={props.s.x}
					dy={props.s.y}
					result={`s${props.i}-o`}
				/>
			</Show>
			<feFlood flood-color={props.s.color} result={`s${props.i}-c`} />
			<feComposite
				in={`s${props.i}-c`}
				in2={source()}
				operator="in"
				result={`s${props.i}`}
			/>
		</>
	);
}
