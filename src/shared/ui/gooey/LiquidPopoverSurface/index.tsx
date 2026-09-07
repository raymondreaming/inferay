import { createPortal } from "octane";
import { GooeyRoot } from "../Gooey/index.tsx";
import { LiquidItem } from "../LiquidItem/index.tsx";
import type { ReactNode } from "../observer.ts";
import * as inlineStyles from "./styles.ts";
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
		<GooeyRoot
			blur={6}
			contrast={18}
			fill={fill}
			filterPadding={present ? 440 : 18}
			shadow="inset 0 1px 0 rgba(255,255,255,.12), 0 14px 40px rgba(0,0,0,.42)"
			className="inferay-liquid-popover"
			style={inlineStyles.getLiquidPopoverSurfaceLiquidStyle(
				fullWidth ? "flex" : "inline-flex",
				fullWidth ? "100%" : undefined,
				present ? 319 : undefined,
			)}
		>
			<LiquidItem
				style={inlineStyles.getLiquidPopoverSurfaceElementStyle(
					fullWidth ? "100%" : undefined,
				)}
			>
				{trigger}
			</LiquidItem>
			{present &&
				createPortal(
					<LiquidItem observe radius={panelRadius}>
						{panel}
					</LiquidItem>,
					portalTarget,
				)}
		</GooeyRoot>
	);
}
