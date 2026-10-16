import { APP_REGION_NO_DRAG_CLASS } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import { styles } from "./styles.ts";

export function WorkspaceDockHandle(props: {
	onDragStart?: (event: PointerEvent) => void;
}) {
	return (
		<span
			data-workspace-dock-drag-source="true"
			onPointerDown={props.onDragStart}
			title="Drag panel to dock"
			class={`${APP_REGION_NO_DRAG_CLASS} ${stylex.attrs(styles.handle).class ?? ""}`}
		>
			{Array.from({ length: 6 }, () => (
				<span {...stylex.attrs(styles.dot)} />
			))}
		</span>
	);
}
