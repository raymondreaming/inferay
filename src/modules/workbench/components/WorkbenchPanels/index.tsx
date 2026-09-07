import * as stylex from "@stylexjs/stylex";
import type { Element } from "solid-js";
import { captureEvent, domStyle } from "../../../../shared/lib/dom.tsx";
import { diffRailStyle, styles } from "./styles.ts";

export { WorkbenchSidebar } from "./WorkbenchSidebar.tsx";
export function WorkbenchDiffRail(_props: {
	graph: boolean;
	zenMode: boolean;
	width: number;
	maxWidth: string;
	onFocus: () => void;
	onResize: (
		event: PointerEvent & {
			currentTarget: HTMLButtonElement;
		},
	) => void;
	children?: Element;
}) {
	return (
		<aside
			{...stylex.attrs(
				styles.diffRail,
				_props.graph && styles.graphRail,
				_props.zenMode && styles.diffRailZen,
			)}
			style={domStyle(
				_props.zenMode
					? undefined
					: diffRailStyle(_props.width, _props.maxWidth),
			)}
			ref={captureEvent("pointerdown", (event) => _props.onFocus?.())}
		>
			<button
				type="button"
				aria-label="Resize diff panel"
				onPointerDown={_props.onResize}
				{...stylex.attrs(styles.diffResizeHandle)}
			/>
			{_props.children}
		</aside>
	);
}
