import type { Element } from "solid-js";
import { createMemo, For } from "solid-js";
import type { ShadowLayer } from "../../../../../build/presentation/contracts/ShadowLayer.ts";
import { InsetPass } from "./InsetPass.tsx";
import { ShadowPass } from "./ShadowPass.tsx";

/** Alpha-binarize matrix used before spread dilation: the goo alpha has a soft
 *  fringe past the opaque edge — dilating it directly pushes a spread ring a
 *  pixel out and the fringe reads as a second hairline. */

const BINARIZE = "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 60 -29.5";
export function GooFilterPrimitives(_props: {
	blur: number;
	contrast: number;
	shadows: ShadowLayer[];
}): Element {
	// Intercept tracks the slope so the alpha threshold stays near the same
	// crossing as the classic 18/-7 goo pairing.
	const intercept = createMemo(
		() => Math.round((0.5 - _props.contrast * (5 / 12)) * 100) / 100,
	);
	return (
		<>
			<feGaussianBlur
				in="SourceGraphic"
				stdDeviation={_props.blur}
				result="blur"
			/>
			<feColorMatrix
				in="blur"
				type="matrix"
				values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${_props.contrast} ${intercept()}`}
				result="goo"
			/>
			<feComposite
				in="SourceGraphic"
				in2="goo"
				operator="atop"
				result="shape"
			/>
			{/* Binarized silhouette, computed ONCE and shared by every pass that
          needs it. Each inset pass and each spread pass used to run this
          identical feColorMatrix themselves — on a 5-layer stack that was
          three redundant full-region passes per repaint. */}
			{_props.shadows.some((s) => s.inset || s.spread !== 0) && (
				<feColorMatrix
					in="shape"
					type="matrix"
					values={BINARIZE}
					result="bin"
				/>
			)}
			{
				<For each={_props.shadows} keyed={false}>
					{(s, i) =>
						s().inset ? (
							<InsetPass i={i} s={s()} />
						) : (
							<ShadowPass i={i} s={s()} />
						)
					}
				</For>
			}
			{_props.shadows.length > 0 && (
				<feMerge>
					{/* CSS paints the first shadow of the list on top: outer passes
              merge in reverse (among themselves) BELOW the shape; inset
              passes paint ABOVE it — they live inside the liquid edge. */}
					{
						<For
							each={_props.shadows
								.map((s, i) => (!s.inset ? i : -1))
								.filter((i) => i >= 0)
								.reverse()}
							keyed={false}
						>
							{(i) => <feMergeNode in={`s${i()}`} />}
						</For>
					}
					<feMergeNode in="shape" />
					{
						<For each={_props.shadows} keyed={false}>
							{(s, i) => (s().inset ? <feMergeNode in={`s${i}`} /> : null)}
						</For>
					}
				</feMerge>
			)}
		</>
	);
}
