import { type Accessor, createEffect } from "solid-js";
import { MIN_RESPONSIVE_PANE_WIDTH } from "./dockGeometry.ts";

/** Keeps a grid within the number of pane columns its container can display. */
export function useResponsiveGridColumns(
	container: () => HTMLElement | null,
	columns: Accessor<number>,
	isGrid: Accessor<boolean>,
	setAvailableColumns: (value: (current: number) => number) => void,
) {
	createEffect(
		() => [columns(), isGrid()] as const,
		([configuredColumns, grid]) => {
			const element = container();
			if (!element || !grid) return;
			const update = (width: number) => {
				if (width <= 0) return;
				const next = Math.max(
					1,
					Math.min(
						4,
						configuredColumns,
						Math.floor(width / MIN_RESPONSIVE_PANE_WIDTH),
					),
				);
				setAvailableColumns((current) => (current === next ? current : next));
			};
			update(element.getBoundingClientRect().width);
			if (typeof ResizeObserver === "undefined") return;
			const observer = new ResizeObserver((entries) => {
				const width = entries[0]?.contentRect.width;
				if (width !== undefined) update(width);
			});
			observer.observe(element);
			return () => observer.disconnect();
		},
	);
}
