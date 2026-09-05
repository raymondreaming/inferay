import type { ReactElement } from "../../../../types/octane-react-compat.ts";
import type { ShadowLayer } from "../shadow";

/** Alpha-binarize matrix used before spread dilation: the goo alpha has a soft
 *  fringe past the opaque edge — dilating it directly pushes a spread ring a
 *  pixel out and the fringe reads as a second hairline. */

export function ShadowPass({
	i,
	s,
}: {
	i: number;
	s: ShadowLayer;
}): ReactElement {
	const parts: ReactElement[] = [];
	let src = "shape";
	if (s.spread !== 0) {
		parts.push(
			<feMorphology
				key="sp"
				in="bin"
				operator={s.spread > 0 ? "dilate" : "erode"}
				radius={Math.abs(s.spread)}
				result={`s${i}-sp`}
			/>,
		);
		src = `s${i}-sp`;
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
	if (s.x !== 0 || s.y !== 0) {
		parts.push(
			<feOffset key="o" in={src} dx={s.x} dy={s.y} result={`s${i}-o`} />,
		);
		src = `s${i}-o`;
	}
	parts.push(
		<feFlood key="c" floodColor={s.color} result={`s${i}-c`} />,
		<feComposite
			key="f"
			in={`s${i}-c`}
			in2={src}
			operator="in"
			result={`s${i}`}
		/>,
	);
	return <>{parts}</>;
}
