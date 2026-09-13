import { type Accessor, createEffect, createSignal } from "solid-js";

type MenuLayout = {
	element: HTMLButtonElement | null;
	liquid: boolean;
	placement: "auto" | "top" | "bottom";
	rowHeight: number;
	count: number;
	maxVisible?: number;
	minWidth: number;
};

/** Measure after option updates commit, retaining only the open menu's observers. */
export function useDropdownPosition(layout: Accessor<MenuLayout | null>) {
	const [position, setPosition] = createSignal({
		top: 0,
		bottom: 0,
		left: 0,
		width: 0,
		maxH: 300,
		placement: "bottom" as "top" | "bottom",
	});
	createEffect(layout, (layout) => {
		if (!layout?.element) return;
		const {
			element,
			liquid,
			placement,
			rowHeight,
			count,
			maxVisible,
			minWidth,
		} = layout;
		const measure = () => {
			const rect = element.getBoundingClientRect();
			const gap = liquid ? 12 : 4;
			const below = window.innerHeight - rect.bottom - gap;
			const above = rect.top - gap;
			const onTop =
				placement === "top" || (placement === "auto" && above > below);
			const visibleCount = maxVisible ? Math.min(count, maxVisible) : count;
			const contentHeight = Math.min(
				visibleCount * rowHeight + (count > 5 ? 38 : 0) + 2,
				400,
			);
			const width = Math.max(rect.width, minWidth);
			setPosition({
				top: onTop ? 0 : rect.bottom + gap,
				bottom: onTop ? window.innerHeight - rect.top + gap : 0,
				left: Math.min(
					Math.max(8, rect.left),
					Math.max(8, window.innerWidth - width - 8),
				),
				width,
				maxH: Math.max(0, Math.min(contentHeight, onTop ? above : below)),
				placement: onTop ? "top" : "bottom",
			});
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		window.addEventListener("resize", measure);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
		};
	});
	return position;
}
