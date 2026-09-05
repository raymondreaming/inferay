import * as stylex from "@octanejs/stylex";
import { APP_REGION_NO_DRAG_CLASS } from "../../../../app/model/appearance.ts";
import { styles } from "./styles.ts";

export function WorkspaceDockHandle({
	draggable,
	onDragStart,
}: {
	readonly draggable?: boolean;
	readonly onDragStart?: (event: PointerEvent) => void;
	readonly onDragEnd?: () => void;
}) {
	if (!draggable) return null;
	const handleProps = stylex.props(styles.handle);
	return (
		<span
			data-workspace-dock-drag-source="true"
			onPointerDown={onDragStart}
			title="Drag panel to dock"
			{...handleProps}
			className={`${APP_REGION_NO_DRAG_CLASS} ${handleProps.className ?? ""}`}
		>
			{Array.from({ length: 6 }, (_, index) => (
				<span key={index} {...stylex.props(styles.dot)} />
			))}
		</span>
	);
}
