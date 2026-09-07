import * as stylex from "@stylexjs/stylex";
import type { Element } from "solid-js";
import { domStyle } from "../../../../shared/lib/dom.tsx";
import { sidebarStyle, styles } from "./styles.ts";
export function WorkbenchSidebar(_props: {
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
	return (
		<aside
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
