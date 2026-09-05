import * as stylex from "@octanejs/stylex";
import { diffRailStyle, styles } from "./styles.ts";

export { WorkbenchSidebar } from "./WorkbenchSidebar.tsx";
export function WorkbenchDiffRail({
	graph,
	zenMode,
	width,
	maxWidth,
	onFocus,
	onResize,
	children,
}: {
	graph: boolean;
	zenMode: boolean;
	width: number;
	maxWidth: string;
	onFocus: () => void;
	onResize: (
		event: PointerEvent & { currentTarget: HTMLButtonElement },
	) => void;
	children?: unknown;
}) {
	return (
		<aside
			{...stylex.props(
				styles.diffRail,
				graph && styles.graphRail,
				zenMode && styles.diffRailZen,
			)}
			style={zenMode ? undefined : diffRailStyle(width, maxWidth)}
			onPointerDownCapture={onFocus}
		>
			<button
				type="button"
				aria-label="Resize diff panel"
				onPointerDown={onResize}
				{...stylex.props(styles.diffResizeHandle)}
			/>
			{children}
		</aside>
	);
}
