import type { ReactNode } from "../../../../types/octane-react-compat.ts";
import { Liquid } from "../index.ts";
import * as inlineStyles from "./styles.ts";

export interface LiquidActionSurfaceProps {
	children?: ReactNode;
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
		<Liquid
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
			<Liquid.Item
				effect="move"
				move={{ springiness: 0.62, wobble: 0.3, stretch: 0.28, trail: 0.4 }}
			>
				{children}
			</Liquid.Item>
		</Liquid>
	);
}
