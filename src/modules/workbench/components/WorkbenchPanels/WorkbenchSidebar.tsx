import * as stylex from "@octanejs/stylex";
import { sidebarStyle, styles } from "./styles.ts";
export function WorkbenchSidebar({
	visible,
	width,
	error,
	onResize,
	children,
}: {
	visible: boolean;
	width: number;
	error: string | null;
	onResize: (
		event: PointerEvent & { currentTarget: HTMLButtonElement },
	) => void;
	children?: unknown;
}) {
	return (
		<aside
			{...stylex.props(styles.sidebarShell)}
			style={sidebarStyle(visible ? width : 0)}
		>
			{error ? (
				<div role="alert" {...stylex.props(styles.persistenceError)}>
					{error}
				</div>
			) : null}
			{visible ? (
				<>
					<button
						type="button"
						aria-label="Resize changes sidebar"
						onPointerDown={onResize}
						{...stylex.props(styles.resizeHandle)}
					/>
					{children}
				</>
			) : null}
		</aside>
	);
}
