import type { DropdownPosition } from "@contracts";
import { project } from "@shared/lib/native.tsx";
import { type Accessor, createEffect, createSignal } from "solid-js";

type MenuLayout = {
	element: HTMLButtonElement | null;
	placement: "auto" | "top" | "bottom";
	rowHeight: number;
	count: number;
	maxVisible?: number;
	minWidth: number;
};

/** Measure after option updates commit, retaining only the open menu's observers. */
export function useDropdownPosition(layout: Accessor<MenuLayout | null>) {
	const [position, setPosition] = createSignal(
		project<DropdownPosition>("dropdownPosition", {}),
	);
	createEffect(layout, (layout) => {
		if (!layout?.element) return;
		const { element, ...options } = layout;
		const measure = () =>
			setPosition(
				project("dropdownPosition", {
					...options,
					rect: element.getBoundingClientRect(),
					width: window.innerWidth,
					height: window.innerHeight,
				}),
			);
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
