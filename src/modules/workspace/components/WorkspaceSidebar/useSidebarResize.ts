import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import {
	readStoredValue,
	writeStoredValue,
} from "../../../../shared/lib/native.tsx";

const MIN_WIDTH = 188;
const MAX_WIDTH = 340;
const WIDTH_KEY = "main-sidebar-width";
const clampWidth = (width: number) =>
	Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));

export function useSidebarResize(collapsed: Accessor<boolean>) {
	const stored = readStoredValue(WIDTH_KEY);
	const initial = stored === null ? 292 : Number(stored);
	const [width, setWidth] = createSignal(
		Number.isFinite(initial) ? clampWidth(initial) : 292,
	);
	const [resizing, setResizing] = createSignal(false);
	let disposed = false;
	let drag: { startX: number; startWidth: number; width: number } | undefined;
	const release = () => {
		drag = undefined;
		window.removeEventListener("mousemove", move);
		window.removeEventListener("mouseup", finish);
		window.removeEventListener("blur", cancel);
	};
	const move = (event: MouseEvent) => {
		if (!drag) return;
		drag.width = clampWidth(drag.startWidth + event.clientX - drag.startX);
		setWidth(drag.width);
	};
	const finish = () => {
		if (!drag) return;
		// The last mousemove can precede Solid's signal commit in the same event.
		const next = drag.width;
		release();
		setResizing(false);
		writeStoredValue(WIDTH_KEY, String(next));
	};
	const cancel = () => {
		if (!drag) return;
		const previous = drag.startWidth;
		release();
		setWidth(previous);
		setResizing(false);
	};
	onCleanup(() => {
		disposed = true;
		release();
	});
	createEffect(collapsed, (hidden) => {
		if (hidden) cancel();
	});
	const start = (event: MouseEvent) => {
		if (disposed || drag || collapsed() || event.button !== 0) return;
		event.preventDefault();
		const startWidth = width();
		drag = { startX: event.clientX, startWidth, width: startWidth };
		setResizing(true);
		window.addEventListener("mousemove", move);
		window.addEventListener("mouseup", finish);
		window.addEventListener("blur", cancel);
	};
	return { width, resizing, start };
}
