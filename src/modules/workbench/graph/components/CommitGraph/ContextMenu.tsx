import * as stylex from "@octanejs/stylex";
import { getCommitGraphRefContextMenuStyle, styles } from "./styles.ts";

export interface ContextMenuEntry {
	label: string;
	run: () => void;
}

export function ContextMenu({
	title,
	label = title,
	x,
	y,
	entries,
	onClose,
}: {
	title: string;
	label?: string;
	x: number;
	y: number;
	entries: ContextMenuEntry[];
	onClose: () => void;
}) {
	return (
		<div
			role="menu"
			aria-label={`Actions for ${label}`}
			{...stylex.props(styles.refContextMenu)}
			style={getCommitGraphRefContextMenuStyle(x, y)}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<div {...stylex.props(styles.refContextTitle)}>{title}</div>
			{entries.map(({ label, run }) => (
				<button
					key={label}
					type="button"
					role="menuitem"
					onClick={() => {
						run();
						onClose();
					}}
					{...stylex.props(styles.refContextItem)}
				>
					{label}
				</button>
			))}
		</div>
	);
}
