/** Evaluate timing curves used by the observed liquid shape animation. */
const evalCache = new Map<string, (t: number) => number>();
export function easingFunction(spec: string): (t: number) => number {
	let fn = evalCache.get(spec);
	if (fn) return fn;
	const lin = /^linear\(([^)]+)\)$/.exec(spec.trim());
	const bez = /^cubic-bezier\(([^)]+)\)$/.exec(spec.trim());
	if (lin) {
		// Numeric sample lists use evenly spaced stops.
		const values = lin[1].split(",").map(Number);
		fn = (t: number) => {
			if (t <= 0) return values[0];
			if (t >= 1) return values[values.length - 1];
			const f = t * (values.length - 1);
			const i = Math.floor(f);
			return values[i] + (values[i + 1] - values[i]) * (f - i);
		};
	} else if (bez) {
		const [x1, y1, x2, y2] = bez[1].split(",").map(Number);
		fn = (t: number) => {
			if (t <= 0) return 0;
			if (t >= 1) return 1;
			let lo = 0;
			let hi = 1;
			for (let i = 0; i < 24; i++) {
				const mid = (lo + hi) / 2;
				const xm =
					3 * mid * (1 - mid) * (1 - mid) * x1 +
					3 * mid * mid * (1 - mid) * x2 +
					mid ** 3;
				if (xm < t) lo = mid;
				else hi = mid;
			}
			const u = (lo + hi) / 2;
			return 3 * u * (1 - u) * (1 - u) * y1 + 3 * u * u * (1 - u) * y2 + u ** 3;
		};
	} else if (spec === "ease") {
		fn = easingFunction("cubic-bezier(0.25, 0.1, 0.25, 1)");
	} else if (spec === "ease-in") {
		fn = easingFunction("cubic-bezier(0.42, 0, 1, 1)");
	} else if (spec === "ease-out") {
		fn = easingFunction("cubic-bezier(0, 0, 0.58, 1)");
	} else if (spec === "ease-in-out") {
		fn = easingFunction("cubic-bezier(0.42, 0, 0.58, 1)");
	} else {
		fn = (t: number) => Math.min(1, Math.max(0, t));
	}
	evalCache.set(spec, fn);
	return fn;
}
