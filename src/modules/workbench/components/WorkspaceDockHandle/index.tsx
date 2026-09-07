import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import { APP_REGION_NO_DRAG_CLASS } from "../../../../app/hooks/useAppAppearance.tsx";
import { styles } from "./styles.ts";
export function WorkspaceDockHandle(_props: {
	readonly draggable?: boolean;
	readonly onDragStart?: (event: PointerEvent) => void;
	readonly onDragEnd?: () => void;
}) {
	return (
		<>
			{(() => {
				if (!_props.draggable) return null;
				const handleProps = createMemo(() => stylex.attrs(styles.handle));
				return (
					<span
						data-workspace-dock-drag-source="true"
						onPointerDown={_props.onDragStart}
						title="Drag panel to dock"
						{...handleProps()}
						class={`${APP_REGION_NO_DRAG_CLASS} ${handleProps().class ?? ""}`}
					>
						{Array.from(
							{
								length: 6,
							},
							(_, index) => (
								<span {...stylex.attrs(styles.dot)} />
							),
						)}
					</span>
				);
			})()}
		</>
	);
}
