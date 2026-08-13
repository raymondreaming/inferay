import { Liquid } from "./index.ts";

export interface LiquidSegmentedRailProps {
	activeIndex: number;
	itemCount: number;
	direction?: "horizontal" | "vertical";
	fill?: string;
	radius?: number;
	itemSize?: number;
	gap?: number;
}

export function LiquidSegmentedRail({
	activeIndex,
	itemCount,
	direction = "horizontal",
	fill = "var(--color-inferay-gray)",
	radius = 8,
	itemSize,
	gap = 0,
}: LiquidSegmentedRailProps) {
	if (activeIndex < 0) return null;
	const count = Math.max(1, itemCount);
	const horizontal = direction === "horizontal";
	const transform = itemSize
		? horizontal
			? `translateX(${activeIndex * (itemSize + gap)}px)`
			: `translateY(${activeIndex * (itemSize + gap)}px)`
		: horizontal
			? `translateX(${activeIndex * 100}%)`
			: `translateY(${activeIndex * 100}%)`;
	return (
		<div aria-hidden="true" className="inferay-liquid-segmented-rail">
			<Liquid
				blur={3.5}
				contrast={20}
				fill={fill}
				filterPadding={14}
				className="inferay-liquid-segmented-rail__group"
				style={{ height: "100%", width: "100%" }}
			>
				<Liquid.Item
					effect="move"
					move={{
						springiness: 0.72,
						wobble: 0.16,
						stretch: 0.16,
						trail: 0.28,
					}}
				>
					<span
						className="inferay-liquid-segmented-rail__item inferay-liquid-segmented-rail__carrier"
						style={{
							borderRadius: radius,
							width: horizontal ? (itemSize ?? `${100 / count}%`) : "100%",
							height: horizontal ? "100%" : (itemSize ?? `${100 / count}%`),
							transform,
						}}
					/>
				</Liquid.Item>
			</Liquid>
		</div>
	);
}
