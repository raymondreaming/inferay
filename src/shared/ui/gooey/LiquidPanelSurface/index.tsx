import type { Element } from "solid-js";
import { GooeyRoot } from "../Gooey/index.tsx";
import { LiquidItem } from "../LiquidItem/index.tsx";
import * as inlineStyles from "./styles.ts";
export function LiquidPanelSurface(_props: {
	children?: Element;
	fill: string;
}) {
	return (
		<GooeyRoot
			blur={6}
			contrast={20}
			fill={_props.fill}
			filterPadding={30}
			shadow="inset 0 1px 0 rgba(255,255,255,.1), 0 18px 52px rgba(0,0,0,.24)"
			class="inferay-liquid-panel"
			style={inlineStyles.getLiquidPanelSurfaceLiquidStyle()}
		>
			<LiquidItem
				morph={{
					shape: true,
					speed: 1.35,
					bounce: 0.18,
					contentBlur: 0,
				}}
			>
				{_props.children}
			</LiquidItem>
		</GooeyRoot>
	);
}
