import type { OctaneNode } from "octane";
import { GooeyRoot } from "../Gooey/index.tsx";
import { LiquidItem } from "../LiquidItem/index.tsx";
import * as inlineStyles from "./styles.ts";
export interface LiquidActionSurfaceProps {
	children?: OctaneNode;
	fill: string;
	fullWidth?: boolean;
	intense?: boolean;
}
export function LiquidActionSurface({
	children,
	fill,
	fullWidth = false,
	intense = false,
}: LiquidActionSurfaceProps) {
	return (
		<GooeyRoot
			blur={intense ? 6 : 5}
			contrast={20}
			fill={fill}
			filterPadding={18}
			className="inferay-liquid-action"
			style={inlineStyles.getLiquidActionSurfaceLiquidStyle(
				fullWidth ? "flex" : "inline-flex",
				fullWidth ? "100%" : undefined,
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
				{children}
			</LiquidItem>
		</GooeyRoot>
	);
}
