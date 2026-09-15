import { ariaValue } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import { styles } from "./styles.ts";
import type { ColumnWidths } from "./useCommitGraphState.tsx";
export function ColumnResizeHandle(_props: {
	column: keyof ColumnWidths;
	visible: boolean;
	onResizeStart: (column: keyof ColumnWidths, event: PointerEvent) => void;
}) {
	return (
		<button
			type="button"
			aria-label={ariaValue(`Resize ${_props.column} column`)}
			onPointerDown={(event) => _props.onResizeStart(_props.column, event)}
			{...stylex.attrs(
				styles.columnResizeHandle,
				_props.visible && styles.columnResizeHandleVisible,
			)}
		/>
	);
}
