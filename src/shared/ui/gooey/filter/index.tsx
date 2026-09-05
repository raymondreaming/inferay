import type { ReactElement, ShadowLayer } from "../observer.ts";
import { InsetPass } from "./InsetPass.tsx";
import { ShadowPass } from "./ShadowPass.tsx";

/** Alpha-binarize matrix used before spread dilation: the goo alpha has a soft
 *  fringe past the opaque edge — dilating it directly pushes a spread ring a
 *  pixel out and the fringe reads as a second hairline. */

const BINARIZE = "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 60 -29.5";

export function GooFilterPrimitives({
	blur,
	contrast,
	shadows,
}: {
	blur: number;
	contrast: number;
	shadows: ShadowLayer[];
}): ReactElement {
	// Intercept tracks the slope so the alpha threshold stays near the same
	// crossing as the classic 18/-7 goo pairing.
	const intercept = Math.round((0.5 - contrast * (5 / 12)) * 100) / 100;
	return (
		<>
			<feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="blur" />
			<feColorMatrix
				in="blur"
				type="matrix"
				values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${contrast} ${intercept}`}
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
			{shadows.some((s) => s.inset || s.spread !== 0) && (
				<feColorMatrix
					in="shape"
					type="matrix"
					values={BINARIZE}
					result="bin"
				/>
			)}
			{shadows.map((s, i) =>
				s.inset ? (
					<InsetPass key={i} i={i} s={s} />
				) : (
					<ShadowPass key={i} i={i} s={s} />
				),
			)}
			{shadows.length > 0 && (
				<feMerge>
					{/* CSS paints the first shadow of the list on top: outer passes
              merge in reverse (among themselves) BELOW the shape; inset
              passes paint ABOVE it — they live inside the liquid edge. */}
					{shadows
						.map((s, i) => (!s.inset ? i : -1))
						.filter((i) => i >= 0)
						.reverse()
						.map((i) => (
							<feMergeNode key={i} in={`s${i}`} />
						))}
					<feMergeNode in="shape" />
					{shadows.map((s, i) =>
						s.inset ? <feMergeNode key={i} in={`s${i}`} /> : null,
					)}
				</feMerge>
			)}
		</>
	);
}
