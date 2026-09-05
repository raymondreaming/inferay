import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "octane";
import type { Octane } from "octane/jsx-runtime";
import type {
	CSSProperties,
	Ref,
} from "../../../../types/octane-react-compat.ts";
import { GooeyContext, type GooeyContextValue } from "../context";
import { GooFilterPrimitives } from "../filter";
import { useIsoLayoutEffect } from "../hooks";
import { ObserveEngine } from "../observer";
import { parseShadow } from "../shadow";
import * as inlineStyles from "./styles.ts";

export interface GooeyProps extends Octane.HTMLAttributes<HTMLDivElement> {
	ref?: Ref<HTMLDivElement>;
	style?: CSSProperties;
	/** Goo blur sigma in px — how far apart pieces start bridging. Default 6. */
	blur?: number;
	/** Alpha-contrast slope — how sharp the liquid edge is. Default 18. */
	contrast?: number;
	/** Fill of the liquid surface. Any CSS color, `var()` welcome. Default '#fff'. */
	fill?: string;
	/** `box-shadow` syntax; rendered on the MERGED silhouette. `inset` layers
	 *  paint inside the liquid edge (inner rings / top highlights). */
	shadow?: string;
	/** Extra filter-region slack in px for blobs travelling outside the group box. Default 24. */
	filterPadding?: number;
}

export function GooeyRoot({
	blur = 6,
	contrast = 18,
	fill = "#fff",
	shadow,
	filterPadding = 24,
	className,
	style,
	children,
	ref: fwd,
	...rest
}: GooeyProps) {
	const groupRef = useRef<HTMLDivElement | null>(null);
	const [portal, setPortal] = useState<SVGGElement | null>(null);
	const [size, setSize] = useState({ w: 0, h: 0 });

	const setRefs = useCallback(
		(node: HTMLDivElement | null) => {
			groupRef.current = node;
			if (typeof fwd === "function") fwd(node);
			else if (fwd) (fwd as { current: HTMLDivElement | null }).current = node;
		},
		[fwd],
	);

	const filterId = `gooey-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
	const shadows = useMemo(() => parseShadow(shadow), [shadow]);

	useIsoLayoutEffect(() => {
		const el = groupRef.current;
		if (!el) return;
		const measure = () =>
			setSize((prev) =>
				prev.w === el.offsetWidth && prev.h === el.offsetHeight
					? prev
					: { w: el.offsetWidth, h: el.offsetHeight },
			);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const engine = useMemo(() => new ObserveEngine(() => groupRef.current), []);
	useEffect(() => () => engine.dispose(), [engine]);
	useEffect(() => {
		engine.gooBlur = blur;
	}, [engine, blur]);

	const ctx = useMemo<GooeyContextValue>(
		() => ({
			portal,
			fill,
			getGroup: () => groupRef.current,
			engine,
		}),
		[portal, fill, engine],
	);

	// The filter raster is the whole performance story on WebKit, which runs
	// SVG filters on the CPU at full device scale — measured at 9fps for a
	// drag on an iPhone-class 3x screen. The heavy layers are the BLURRED
	// outer shadows: a 42px-blur pass re-rasterises the entire padded region
	// every animated frame. CSS drop-shadow() is mathematically the same
	// operation (blur-radius = 2σ, exactly box-shadow's convention, exactly
	// the stdDeviation = blur/2 the SVG pass used) — but a CSS filter list on
	// the element runs on the COMPOSITOR, GPU-accelerated in both WebKit and
	// Chromium. So the stack is split:
	//   - blurred/offset outer shadows  -> drop-shadow() on the svg element
	//   - spread rings and inset layers -> SVG passes (not expressible in
	//     CSS, but they are morphology/offset ops with no big blurs — cheap)
	//   - the goo chain itself          -> SVG, as before
	// One spec'd difference: chained drop-shadows each see the previous
	// result, so a later shadow also shadows an earlier one's pixels — at the
	// 5-25% alphas shadows use, that cross-term is under 1% alpha, invisible.
	// The filter pad also shrinks to what the REMAINING svg layers reach,
	// which cuts the rasterised area again.
	const svgShadows = shadows.filter((s) => s.inset || s.spread !== 0);
	const cssShadowFilter = shadows
		.filter((s) => !s.inset && s.spread === 0)
		// box-shadow lists paint the FIRST layer on top; drop-shadow chains
		// paint later filters behind earlier output, so document order already
		// matches.
		.map((s) => `drop-shadow(${s.x}px ${s.y}px ${s.blur}px ${s.color})`)
		.join(" ");
	const shadowExtent = svgShadows.reduce(
		(m, s) =>
			Math.max(
				m,
				Math.max(Math.abs(s.x), Math.abs(s.y)) +
					s.blur * 1.5 +
					Math.max(0, s.spread),
			),
		0,
	);
	const pad = Math.ceil(blur * 3 + shadowExtent + filterPadding);

	return (
		<div
			{...rest}
			ref={setRefs}
			className={className}
			style={inlineStyles.getGooeyRootDivStyle(style)}
		>
			{/* zIndex -1 inside the isolated group: the liquid paints above the
          group's own background but below every child, positioned or not. */}
			<svg
				aria-hidden="true"
				focusable="false"
				data-gooey-svg=""
				style={inlineStyles.getGooeyRootSvgStyle(cssShadowFilter || undefined)}
			>
				<defs>
					<filter
						id={filterId}
						filterUnits="userSpaceOnUse"
						x={-pad}
						y={-pad}
						width={size.w + pad * 2}
						height={size.h + pad * 2}
						colorInterpolationFilters="sRGB"
					>
						<GooFilterPrimitives
							blur={blur}
							contrast={contrast}
							shadows={svgShadows}
						/>
					</filter>
				</defs>
				<g
					id={`${filterId}-sil`}
					ref={setPortal}
					filter={`url(#${filterId})`}
					style={inlineStyles.getGooeyRootGStyle(fill)}
				/>
			</svg>
			<GooeyContext.Provider value={ctx}>{children}</GooeyContext.Provider>
		</div>
	);
}
