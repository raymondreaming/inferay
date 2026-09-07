import { Portal } from "@solidjs/web";
import type { Element } from "solid-js";
import { GooeyRoot } from "../Gooey/index.tsx";
import { LiquidItem } from "../LiquidItem/index.tsx";
import * as inlineStyles from "./styles.ts";
export interface LiquidPopoverSurfaceProps {
	open: boolean;
	present?: boolean;
	trigger: Element;
	panel: Element;
	portalTarget: globalThis.Element;
	fill: string;
	fullWidth?: boolean;
	panelRadius?: number;
}
export function LiquidPopoverSurface(_props: LiquidPopoverSurfaceProps) {
	return (
		<GooeyRoot
			blur={6}
			contrast={18}
			fill={_props.fill}
			filterPadding={
				(_props.present === undefined ? _props.open : _props.present) ? 440 : 18
			}
			shadow="inset 0 1px 0 rgba(255,255,255,.12), 0 14px 40px rgba(0,0,0,.42)"
			class="inferay-liquid-popover"
			style={inlineStyles.getLiquidPopoverSurfaceLiquidStyle(
				(_props.fullWidth === undefined ? false : _props.fullWidth)
					? "flex"
					: "inline-flex",
				(_props.fullWidth === undefined ? false : _props.fullWidth)
					? "100%"
					: undefined,
				(_props.present === undefined ? _props.open : _props.present)
					? 319
					: undefined,
			)}
		>
			<LiquidItem
				style={inlineStyles.getLiquidPopoverSurfaceElementStyle(
					(_props.fullWidth === undefined ? false : _props.fullWidth)
						? "100%"
						: undefined,
				)}
			>
				{_props.trigger}
			</LiquidItem>
			{(_props.present === undefined ? _props.open : _props.present) && (
				<Portal mount={_props.portalTarget}>
					{
						<LiquidItem
							observe
							radius={_props.panelRadius === undefined ? 8 : _props.panelRadius}
						>
							{_props.panel}
						</LiquidItem>
					}
				</Portal>
			)}
		</GooeyRoot>
	);
}
