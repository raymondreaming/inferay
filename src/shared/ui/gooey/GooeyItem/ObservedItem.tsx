import { Portal } from "@solidjs/web";
import { createEffect, createMemo } from "solid-js";
import { domStyle } from "../../../lib/dom.tsx";
import {
	EVOLVE_DEFAULTS,
	MOVE_DEFAULTS,
	normalizeRadius,
} from "../Gooey/index.tsx";
import type { Internal } from "./index.tsx";
import * as inlineStyles from "./styles.ts";
export function ObservedItem(_props: Internal) {
	const hostRef = {
		current: null,
	} as {
		current: HTMLSpanElement | null;
	};
	const blobRef = {
		current: null,
	} as {
		current: SVGRectElement | null;
	};
	const effects = createMemo(() => toEffects(_props.effect));
	const dynamics = createMemo(() => {
		const _effectsValue = effects();
		return {
			evolve: _effectsValue.includes("evolve"),
			move: _effectsValue.includes("move"),
			evolveOpts: {
				...EVOLVE_DEFAULTS,
				..._props.evolve,
			},
			moveOpts: {
				...MOVE_DEFAULTS,
				..._props.move,
			},
		};
	});
	const hasDynamics = createMemo(() => {
		const _dynamicsValue = dynamics();
		return _dynamicsValue.evolve || _dynamicsValue.move;
	});
	const radiusKey = createMemo(() =>
		_props.radius == null ? "" : JSON.stringify(_props.radius),
	);
	const effectKey = createMemo(() => {
		const _dynamicsValue2 = dynamics();
		return (
			effects().join(",") +
			(_dynamicsValue2.evolve
				? JSON.stringify(_dynamicsValue2.evolveOpts)
				: "") +
			(_dynamicsValue2.move ? JSON.stringify(_dynamicsValue2.moveOpts) : "")
		);
	});
	createEffect(
		() => [
			_props.ctx,
			radiusKey(),
			effectKey(),
			_props.blobInset,
			_props.bridgeGrow,
		],
		() => {
			const host = hostRef.current;
			const blob = blobRef.current;
			const target = (host?.firstElementChild as HTMLElement | null) ?? null;
			if (!target || !blob) return;
			return _props.ctx.engine.add({
				target,
				blob,
				radius:
					_props.radius == null ? undefined : normalizeRadius(_props.radius)[0],
				blobInset: _props.blobInset,
				bridgeGrow: _props.bridgeGrow,
				dynamics: hasDynamics() ? dynamics() : undefined,
			});
		},
	);
	return (
		<>
			<span
				ref={(element) => (hostRef.current = element)}
				class={_props.class}
				style={domStyle(inlineStyles.getObservedItemSpanStyle(_props.style))}
			>
				{_props.children}
			</span>
			{_props.ctx.portal && (
				<Portal mount={_props.ctx.portal}>
					{
						<rect
							ref={(element) => (blobRef.current = element)}
							x={0}
							y={0}
							width={0}
							height={0}
							style={domStyle(inlineStyles.getObservedItemRectStyle())}
						/>
					}
				</Portal>
			)}
		</>
	);
}
export function toEffects(
	effect: GooeyEffect | GooeyEffect[] | undefined,
): GooeyEffect[] {
	return Array.isArray(effect) ? effect : effect ? [effect] : [];
}

import type { GooeyEffect } from "./index.tsx";
