import { captureEvent } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import type { Element } from "solid-js";
import { styles } from "./styles.ts";

export { WorkbenchSidebar } from "./WorkbenchSidebar.tsx";
export function WorkbenchDiffRail(_props: {
	ref?: (element: HTMLElement) => void;
	onFocus: () => void;
	children?: Element;
}) {
	const captureFocus = captureEvent("pointerdown", () => _props.onFocus());
	return (
		<aside
			data-onboarding="diff"
			{...stylex.attrs(styles.diffRail)}
			ref={(element) => {
				_props.ref?.(element);
				captureFocus(element);
			}}
		>
			{_props.children}
		</aside>
	);
}
