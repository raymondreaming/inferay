import * as stylex from "@octanejs/stylex";
import { APP_REGION_NO_DRAG_CLASS } from "../../lib/app-theme.ts";
import { color, controlSize, radius } from "../../tokens.stylex.ts";

export function WorkspaceDockHandle({
	draggable,
	onDragStart,
	onDragEnd,
}: {
	readonly draggable?: boolean;
	readonly onDragStart?: (event: DragEvent) => void;
	readonly onDragEnd?: () => void;
}) {
	if (!draggable) return null;
	const handleProps = stylex.props(styles.handle);
	return (
		<button
			type="button"
			draggable
			data-workspace-dock-drag-source="true"
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			title="Drag panel to dock"
			aria-label="Drag panel to dock"
			{...handleProps}
			className={`${APP_REGION_NO_DRAG_CLASS} ${handleProps.className ?? ""}`}
		>
			{Array.from({ length: 6 }, (_, index) => (
				<span key={index} {...stylex.props(styles.dot)} />
			))}
		</button>
	);
}

const styles = stylex.create({
	handle: {
		display: "grid",
		width: controlSize._5,
		height: controlSize._5,
		flexShrink: 0,
		gridTemplateColumns: "repeat(2, 3px)",
		gridTemplateRows: "repeat(3, 3px)",
		alignContent: "center",
		justifyContent: "center",
		gap: 2,
		borderRadius: radius.sm,
		borderWidth: 0,
		padding: 0,
		cursor: { default: "grab", ":active": "grabbing" },
		backgroundColor: { default: "transparent", ":hover": color.surfaceControl },
	},
	dot: {
		width: 2,
		height: 2,
		borderRadius: radius.pill,
		backgroundColor: color.textMuted,
	},
});
