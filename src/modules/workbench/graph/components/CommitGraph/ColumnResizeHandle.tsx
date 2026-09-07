import * as stylex from "@octanejs/stylex";
import { styles } from "./styles.ts";
import type { ColumnWidths } from "./useCommitGraphState.tsx";
export function ColumnResizeHandle({
	column,
	onResizeStart,
}: {
	column: keyof ColumnWidths;
	onResizeStart: (column: keyof ColumnWidths, event: PointerEvent) => void;
}) {
	return (
		<button
			type="button"
			aria-label={`Resize ${column} column`}
			onPointerDown={(event) => onResizeStart(column, event)}
			{...stylex.props(styles.columnResizeHandle)}
		/>
	);
}
