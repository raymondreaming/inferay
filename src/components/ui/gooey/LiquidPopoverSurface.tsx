import { createPortal } from "octane";
import type { ReactNode } from "../../../types/octane-react-compat.ts";
import { Liquid } from "./index.ts";

export interface LiquidPopoverSurfaceProps {
	open: boolean;
	present?: boolean;
	trigger: ReactNode;
	panel: ReactNode;
	portalTarget: Element;
	fill: string;
	fullWidth?: boolean;
	panelRadius?: number;
}

/** One liquid system spanning an anchored trigger and its portalled layer.
 * The semantic controls remain real DOM; the observed panel contributes its
 * geometry to the trigger's shared SVG silhouette. */
export function LiquidPopoverSurface({
	open,
	present = open,
	trigger,
	panel,
	portalTarget,
	fill,
	fullWidth = false,
	panelRadius = 8,
}: LiquidPopoverSurfaceProps) {
	return (
		<Liquid
			blur={6}
			contrast={18}
			fill={fill}
			filterPadding={present ? 440 : 18}
			shadow="inset 0 1px 0 rgba(255,255,255,.12), 0 14px 40px rgba(0,0,0,.42)"
			className="inferay-liquid-popover"
			style={{
				display: fullWidth ? "flex" : "inline-flex",
				width: fullWidth ? "100%" : undefined,
				zIndex: present ? 319 : undefined,
			}}
		>
			<Liquid.Item style={{ width: fullWidth ? "100%" : undefined }}>
				{trigger}
			</Liquid.Item>
			{present &&
				createPortal(
					<Liquid.Item observe radius={panelRadius}>
						{panel}
					</Liquid.Item>,
					portalTarget,
				)}
		</Liquid>
	);
}
