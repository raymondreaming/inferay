import * as stylex from "@octanejs/stylex";
import { APP_REGION_NO_DRAG_CLASS } from "../../lib/app-theme.ts";
import { color, controlSize, radius } from "../../tokens.stylex.ts";

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
		gap: controlSize._0_5,
		borderRadius: radius.sm,
		borderWidth: 0,
		padding: controlSize._0,
		touchAction: "none",
		userSelect: "none",
		cursor: { default: "grab", ":active": "grabbing" },
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceControl,
		},
	},
	dot: {
		width: controlSize._0_5,
		height: controlSize._0_5,
		borderRadius: radius.pill,
		backgroundColor: color.textMuted,
	},
});
