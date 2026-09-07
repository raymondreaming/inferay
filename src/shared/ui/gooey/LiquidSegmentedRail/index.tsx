import { createMemo } from "solid-js";
import { domStyle } from "../../../lib/dom.tsx";
import { GooeyRoot } from "../Gooey/index.tsx";
import { LiquidItem } from "../LiquidItem/index.tsx";
import * as inlineStyles from "./styles.ts";
export interface LiquidSegmentedRailProps {
	activeIndex: number;
	itemCount: number;
	direction?: "horizontal" | "vertical";
	fill?: string;
	radius?: number;
	itemSize?: number;
	gap?: number;
}
export function LiquidSegmentedRail(_props: LiquidSegmentedRailProps) {
	return (
		<>
			{(() => {
				if (_props.activeIndex < 0) return null;
				const count = createMemo(() => Math.max(1, _props.itemCount));
				const horizontal = createMemo(
					() =>
						(_props.direction === undefined
							? "horizontal"
							: _props.direction) === "horizontal",
				);
				const transform = createMemo(() => {
					const _horizontalValue = horizontal();
					return _props.itemSize
						? _horizontalValue
							? `translateX(${_props.activeIndex * (_props.itemSize + (_props.gap === undefined ? 0 : _props.gap))}px)`
							: `translateY(${_props.activeIndex * (_props.itemSize + (_props.gap === undefined ? 0 : _props.gap))}px)`
						: _horizontalValue
							? `translateX(${_props.activeIndex * 100}%)`
							: `translateY(${_props.activeIndex * 100}%)`;
				});
				return (
					<div aria-hidden="true" class="inferay-liquid-segmented-rail">
						<GooeyRoot
							blur={3.5}
							contrast={20}
							fill={
								_props.fill === undefined
									? "var(--color-inferay-gray)"
									: _props.fill
							}
							filterPadding={14}
							class="inferay-liquid-segmented-rail__group"
							style={inlineStyles.getLiquidSegmentedRailLiquidStyle()}
						>
							<LiquidItem
								effect="move"
								move={{
									springiness: 0.72,
									wobble: 0.16,
									stretch: 0.16,
									trail: 0.28,
								}}
							>
								<span
									class="inferay-liquid-segmented-rail__item inferay-liquid-segmented-rail__carrier"
									style={domStyle(
										inlineStyles.getLiquidSegmentedRailSpanStyle(
											_props.radius === undefined ? 8 : _props.radius,
											horizontal()
												? (_props.itemSize ?? `${100 / count()}%`)
												: "100%",
											horizontal()
												? "100%"
												: (_props.itemSize ?? `${100 / count()}%`),
											transform(),
										),
									)}
								/>
							</LiquidItem>
						</GooeyRoot>
					</div>
				);
			})()}
		</>
	);
}
