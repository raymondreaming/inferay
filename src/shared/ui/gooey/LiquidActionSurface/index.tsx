import type { Element } from "solid-js";
import { GooeyRoot } from "../Gooey/index.tsx";
import { LiquidItem } from "../LiquidItem/index.tsx";
import * as inlineStyles from "./styles.ts";
export interface LiquidActionSurfaceProps {
	children?: Element;
	fill: string;
	fullWidth?: boolean;
	intense?: boolean;
}
export function LiquidActionSurface(_props: LiquidActionSurfaceProps) {
	return (
		<GooeyRoot
			blur={(_props.intense === undefined ? false : _props.intense) ? 6 : 5}
			contrast={20}
			fill={_props.fill}
			filterPadding={18}
			class="inferay-liquid-action"
			style={inlineStyles.getLiquidActionSurfaceLiquidStyle(
				(_props.fullWidth === undefined ? false : _props.fullWidth)
					? "flex"
					: "inline-flex",
				(_props.fullWidth === undefined ? false : _props.fullWidth)
					? "100%"
					: undefined,
			)}
		>
			<LiquidItem
				effect="move"
				move={{
					springiness: 0.62,
					wobble: 0.3,
					stretch: 0.28,
					trail: 0.4,
				}}
			>
				{_props.children}
			</LiquidItem>
		</GooeyRoot>
	);
}
