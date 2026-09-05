import type { ReactElement } from "../../../../types/octane-react-compat.ts";
import type { ShadowLayer } from "../shadow";

/** Alpha-binarize matrix used before spread dilation: the goo alpha has a soft
 *  fringe past the opaque edge — dilating it directly pushes a spread ring a
 *  pixel out and the fringe reads as a second hairline. */

export function InsetPass({
	i,
	s,
}: {
	i: number;
	s: ShadowLayer;
}): ReactElement {
	const parts: ReactElement[] = [];
	// `bin` is computed once for the whole stack (see GooFilterPrimitives) —
	// every full-region pass costs real milliseconds on WebKit's CPU
	// rasterizer, and each pass here used to re-binarize `shape` identically.
	let src = "bin";
	// Erode by the SPREAD only. An offset-only inset (`inset 0 1px 0 0`) must
	// leave a 1px strip along the TOP edge and nothing else — eroding for it
	// too shrinks the shape all round and paints a spurious ring on the sides
	// and bottom, doubling up with a real inner ring in the same stack.
	if (s.spread !== 0) {
		parts.push(
			<feMorphology
				key="er"
				in={src}
				operator={s.spread > 0 ? "erode" : "dilate"}
				radius={Math.abs(s.spread)}
				result={`s${i}-er`}
			/>,
		);
		src = `s${i}-er`;
	}
	if (s.x !== 0 || s.y !== 0) {
		parts.push(
			<feOffset key="o" in={src} dx={s.x} dy={s.y} result={`s${i}-o`} />,
		);
		src = `s${i}-o`;
	}
	if (s.blur > 0) {
		parts.push(
			<feGaussianBlur
				key="b"
				in={src}
				stdDeviation={s.blur / 2}
				result={`s${i}-b`}
			/>,
		);
		src = `s${i}-b`;
	}
	parts.push(
		// The band: silhouette minus its shrunk/offset self.
		<feComposite
			key="band"
			in="bin"
			in2={src}
			operator="out"
			result={`s${i}-band`}
		/>,
		<feFlood key="c" floodColor={s.color} result={`s${i}-c`} />,
		<feComposite
			key="f"
			in={`s${i}-c`}
			in2={`s${i}-band`}
			operator="in"
			result={`s${i}`}
		/>,
	);
	return <>{parts}</>;
}
