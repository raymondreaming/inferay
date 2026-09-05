import * as stylex from "@octanejs/stylex";
import type { ColumnWidths } from "./shared.ts";
import { styles } from "./styles.ts";

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
