import { captureEvent, domStyle } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import type { Element } from "solid-js";
import { diffRailStyle, styles } from "./styles.ts";

export { WorkbenchSidebar } from "./WorkbenchSidebar.tsx";
export function WorkbenchDiffRail(_props: {
	ref?: (element: HTMLElement) => void;
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
	const captureFocus = captureEvent("pointerdown", () => _props.onFocus());
	return (
		<aside
			{...stylex.attrs(styles.diffRail, _props.zenMode && styles.diffRailZen)}
			style={domStyle(
				_props.zenMode
					? undefined
					: diffRailStyle(_props.width, _props.maxWidth),
			)}
			ref={(element) => {
				_props.ref?.(element);
				captureFocus(element);
			}}
		>
			{!_props.zenMode && (
				<button
					type="button"
					aria-label="Resize diff panel"
					onPointerDown={_props.onResize}
					{...stylex.attrs(styles.diffResizeHandle)}
				/>
			)}
			{_props.children}
		</aside>
	);
}
