import { project } from "@shared/lib/native.tsx";
import { type Accessor, createEffect } from "solid-js";

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
				const next = project<number>("responsiveDockColumns", {
					width,
					columns: configuredColumns,
				});
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
