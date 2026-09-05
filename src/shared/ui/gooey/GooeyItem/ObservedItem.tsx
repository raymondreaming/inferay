import { createPortal, useRef } from "octane";
import {
	EVOLVE_DEFAULTS,
	type Internal,
	MOVE_DEFAULTS,
	normalizeRadius,
	toEffects,
	useIsoLayoutEffect,
} from "../observer.ts";
import * as inlineStyles from "./styles.ts";

export function ObservedItem({
	radius,
	blobInset,
	bridgeGrow,
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
	const effects = toEffects(effect);
	const dynamics = {
		evolve: effects.includes("evolve"),
		move: effects.includes("move"),
		evolveOpts: { ...EVOLVE_DEFAULTS, ...evolve },
		moveOpts: { ...MOVE_DEFAULTS, ...move },
	};
	const hasDynamics = dynamics.evolve || dynamics.move;

	const radiusKey = radius == null ? "" : JSON.stringify(radius);
	const effectKey =
		effects.join(",") +
		(dynamics.evolve ? JSON.stringify(dynamics.evolveOpts) : "") +
		(dynamics.move ? JSON.stringify(dynamics.moveOpts) : "");
	useIsoLayoutEffect(() => {
		const host = hostRef.current;
		const blob = blobRef.current;
		const target = (host?.firstElementChild as HTMLElement | null) ?? null;
		if (!target || !blob) return;
		return ctx.engine.add({
			target,
			blob,
			radius: radius == null ? undefined : normalizeRadius(radius)[0],
			blobInset,
			bridgeGrow,
			dynamics: hasDynamics ? dynamics : undefined,
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ctx, radiusKey, effectKey, blobInset, bridgeGrow]);

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
		</>
	);
}
