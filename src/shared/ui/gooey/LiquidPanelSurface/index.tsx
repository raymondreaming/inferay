import { Liquid } from "../index.ts";
import type { ReactNode } from "../observer.ts";
import * as inlineStyles from "./styles.ts";
export function LiquidPanelSurface({
	children,
	fill,
}: {
	children?: ReactNode;
	fill: string;
}) {
	return (
		<Liquid
			blur={6}
			contrast={20}
			fill={fill}
			filterPadding={30}
			shadow="inset 0 1px 0 rgba(255,255,255,.1), 0 18px 52px rgba(0,0,0,.24)"
			className="inferay-liquid-panel"
			style={inlineStyles.getLiquidPanelSurfaceLiquidStyle()}
		>
			<Liquid.Item
				morph={{
					shape: true,
					speed: 1.35,
					bounce: 0.18,
					contentBlur: 0,
				}}
			>
				{children}
			</Liquid.Item>
		</Liquid>
	);
}
