import { createPortal, useEffect, useRef } from "octane";
import { normalizeRadius } from "../geometry";
import { useIsoLayoutEffect } from "../hooks";
import { EVOLVE_DEFAULTS, MOVE_DEFAULTS } from "../observer";
import { type Internal, toEffects } from "./shared.ts";
import * as inlineStyles from "./styles.ts";

export function ObservedItem({
	radius,
	blobInset,
	bridgeGrow,
	contactBlur,
	effect,
	evolve,
	move,
	className,
	style,
	children,
	ctx,
}: Internal) {
	const hostRef = useRef<HTMLSpanElement | null>(null);
	const blobRef = useRef<SVGRectElement | null>(null);
	const meltRef = useRef<SVGGElement | null>(null);
	const blendRef = useRef<{
		active?: boolean;
		releaseMs?: number;
		fadeMs?: number;
		strength?: number;
		sink?: number;
	} | null>(null);

	const opts = typeof contactBlur === "object" ? contactBlur : {};
	const blendBlur = opts.blur ?? 8;
	const blendWarp = opts.warp ?? 26;
	const blendPull = opts.pull ?? 4;
	const blendRange = opts.range;
	const blendZone = opts.zone;
	const blendMix = opts.mix ?? 0;
	const blendGravity = opts.gravity ?? 60;
	const blendTaper = opts.taper ?? 1;
	const blendWarpFreq = opts.warpFreq ?? 1.7;
	const blendFlowSpeed = opts.flowSpeed ?? 22;
	const blendWarpStyle = opts.warpStyle ?? "fractalNoise";
	const blendDetail = opts.detail ?? 2;
	const blendActive = opts.active !== false;
	const blendRelease = opts.releaseMs ?? 240;
	const blendFade = opts.fadeMs;
	const blendStrength = opts.strength ?? 1;
	// Left undefined when unset so the engine owns the default in one place.
	const blendSink = opts.sink;

	const effects = toEffects(effect);
	const dynamics = {
		evolve: effects.includes("evolve"),
		move: effects.includes("move"),
		evolveOpts: { ...EVOLVE_DEFAULTS, ...evolve },
		moveOpts: { ...MOVE_DEFAULTS, ...move },
	};
	const hasDynamics = dynamics.evolve || dynamics.move;

	const radiusKey = radius == null ? "" : JSON.stringify(radius);
	// `active` is intentionally NOT in the key: it changes every drag and must
	// not tear down the melt structure — the engine reads it live.
	const blendKey = contactBlur
		? `${blendBlur}/${blendWarp}/${blendPull}/${blendRange ?? "auto"}/${blendZone ?? "auto"}/${blendMix}/${blendGravity}/${blendTaper}/${blendWarpFreq}/${blendFlowSpeed}/${blendWarpStyle}/${blendDetail}`
		: "";
	const effectKey =
		effects.join(",") +
		(dynamics.evolve ? JSON.stringify(dynamics.evolveOpts) : "") +
		(dynamics.move ? JSON.stringify(dynamics.moveOpts) : "");
	useIsoLayoutEffect(() => {
		const host = hostRef.current;
		const blob = blobRef.current;
		const target = (host?.firstElementChild as HTMLElement | null) ?? null;
		if (!target || !blob) return;
		const blend =
			contactBlur && meltRef.current
				? {
						host: meltRef.current,
						blur: blendBlur,
						warp: blendWarp,
						pull: blendPull,
						range: blendRange,
						zone: blendZone,
						mix: blendMix,
						gravity: blendGravity,
						taper: blendTaper,
						warpFreq: blendWarpFreq,
						flowSpeed: blendFlowSpeed,
						warpStyle: blendWarpStyle,
						detail: blendDetail,
						active: blendActive,
						releaseMs: blendRelease,
						fadeMs: blendFade,
						strength: blendStrength,
						sink: blendSink,
					}
				: undefined;
		blendRef.current = blend ?? null;
		return ctx.engine.add({
			target,
			blob,
			radius: radius == null ? undefined : normalizeRadius(radius)[0],
			blobInset,
			bridgeGrow,
			blend,
			dynamics: hasDynamics ? dynamics : undefined,
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ctx, radiusKey, blendKey, effectKey, blobInset, bridgeGrow]);

	// `active` / `releaseMs` / `fadeMs` / `strength` / `sink` are pushed
	// straight into the live config so a drag release (or a strength slider)
	// updates the melt without rebuilding its SVG structure.
	useEffect(() => {
		if (!blendRef.current) return;
		blendRef.current.active = blendActive;
		blendRef.current.releaseMs = blendRelease;
		blendRef.current.fadeMs = blendFade;
		blendRef.current.strength = blendStrength;
		blendRef.current.sink = blendSink;
		ctx.engine.wake();
	}, [ctx, blendActive, blendRelease, blendFade, blendStrength, blendSink]);

	return (
		<>
			<span
				ref={hostRef}
				className={className}
				style={inlineStyles.getObservedItemSpanStyle(style)}
			>
				{children}
			</span>
			{ctx.portal &&
				createPortal(
					<rect
						ref={blobRef}
						x={0}
						y={0}
						width={0}
						height={0}
						style={inlineStyles.getObservedItemRectStyle()}
					/>,
					ctx.portal,
				)}
			{contactBlur !== undefined &&
				contactBlur !== false &&
				ctx.meltPortal &&
				createPortal(<g ref={meltRef} opacity={0} />, ctx.meltPortal)}
		</>
	);
}
