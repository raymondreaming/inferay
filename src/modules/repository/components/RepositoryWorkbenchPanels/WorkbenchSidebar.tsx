import { captureEvent, domStyle } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import type { Element } from "solid-js";
import { sidebarStyle, styles } from "./styles.ts";
export function WorkbenchSidebar(_props: {
	ref?: (element: HTMLElement) => void;
	onFocus: () => void;
	visible: boolean;
	width: number;
	error: string | null;
	onResize: (
		event: PointerEvent & {
			currentTarget: HTMLButtonElement;
		},
	) => void;
	children?: Element;
}) {
	const captureFocus = captureEvent("pointerdown", () => _props.onFocus());
	return (
		// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Background clicks restore the sidebar keyboard-navigation target.
		<aside
			ref={(element) => {
				_props.ref?.(element);
				captureFocus(element);
			}}
			onClick={(event) => {
				if (!(event.target instanceof Element)) return;
				const control = event.target.closest(
					'a, button, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [tabindex]',
				);
				if (!control || control === event.currentTarget)
					event.currentTarget.focus({ preventScroll: true });
			}}
			tabindex={-1}
			aria-label="Changes sidebar"
			{...stylex.attrs(styles.sidebarShell)}
			style={domStyle(sidebarStyle(_props.visible ? _props.width : 0))}
		>
			{_props.error ? (
				<div role="alert" {...stylex.attrs(styles.persistenceError)}>
					{_props.error}
				</div>
			) : null}
			{_props.visible ? (
				<>
					<button
						type="button"
						aria-label="Resize changes sidebar"
						onPointerDown={_props.onResize}
						{...stylex.attrs(styles.resizeHandle)}
					/>
					{_props.children}
				</>
			) : null}
		</aside>
	);
}
