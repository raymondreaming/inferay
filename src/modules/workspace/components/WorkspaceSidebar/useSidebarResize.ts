import type { SidebarResize } from "@contracts";
import {
	project,
	readStoredValue,
	writeStoredValue,
} from "@shared/lib/native.tsx";
import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";

const WIDTH_KEY = "main-sidebar-width";

export function useSidebarResize(collapsed: Accessor<boolean>) {
	let current = project<SidebarResize>("sidebarResize", {
		stored: readStoredValue(WIDTH_KEY),
	});
	const [resize, setResize] = createSignal(current);
	const commit = (next: SidebarResize) => {
		current = next;
		setResize(next);
	};
	let disposed = false;
	const release = () => {
		window.removeEventListener("mousemove", move);
		window.removeEventListener("mouseup", finish);
		window.removeEventListener("blur", cancel);
	};
	const update = (action: string, facts: object = {}) =>
		project<SidebarResize>("sidebarResize", {
			state: current,
			action,
			...facts,
		});
	const move = (event: MouseEvent) =>
		commit(update("move", { x: event.clientX }));
	const finish = () => {
		const next = update("finish");
		commit(next);
		release();
		if (next.persist !== null)
			writeStoredValue(WIDTH_KEY, String(next.persist));
	};
	const cancel = () => {
		commit(update("cancel"));
		release();
	};
	onCleanup(() => {
		disposed = true;
		release();
	});
	createEffect(collapsed, (hidden) => {
		if (hidden) cancel();
	});
	const start = (event: MouseEvent) => {
		const wasResizing = resize().resizing;
		const next = update("start", {
			x: event.clientX,
			button: event.button,
			collapsed: collapsed(),
			disposed,
		});
		if (!next.resizing || wasResizing) return;
		commit(next);
		event.preventDefault();
		window.addEventListener("mousemove", move);
		window.addEventListener("mouseup", finish);
		window.addEventListener("blur", cancel);
	};
	return {
		width: () => resize().width,
		resizing: () => resize().resizing,
		start,
	};
}
