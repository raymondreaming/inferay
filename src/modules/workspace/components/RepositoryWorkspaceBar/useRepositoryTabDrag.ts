import type {
	RepositoryTabDrag,
	RepositoryTabsSnapshot,
	RepositoryWorkspace,
} from "@contracts";
import { RepositoryTabs } from "@shared/lib/native.tsx";
import { type Accessor, createMemo, createSignal, onCleanup } from "solid-js";

type Move = { sequence: number; cwd: string; before: string | null };

export function useRepositoryTabDrag(
	workspaces: Accessor<RepositoryWorkspace[]>,
	persist: (cwd: string, beforeCwd: string | null) => Promise<unknown>,
) {
	const model = new RepositoryTabs();
	const [state, setState] = createSignal<RepositoryTabsSnapshot>(
		JSON.parse(model.snapshot()),
	);
	const ordered = createMemo(() => {
		const rows = workspaces();
		void state();
		return (
			JSON.parse(
				model.order(JSON.stringify(rows.map((row) => row.cwd))),
			) as number[]
		).map((index) => rows[index]!);
	});
	let container: HTMLDivElement | undefined;
	let cancel: (() => void) | undefined;
	let disposed = false;
	onCleanup(() => {
		disposed = true;
		cancel?.();
		model.free();
	});
	const sync = () =>
		setState(JSON.parse(model.snapshot()) as RepositoryTabsSnapshot);
	const persistMove = (serialized: string) => {
		const next = JSON.parse(serialized) as Move | null;
		sync();
		if (!next) return;
		void persist(next.cwd, next.before)
			.then((saved) => {
				if (!disposed) {
					model.settle(next.sequence, Boolean(saved));
					sync();
				}
			})
			.catch(() => {
				if (!disposed) {
					model.settle(next.sequence, false);
					sync();
				}
			});
	};
	return {
		ordered,
		dragging: () => state().dragging,
		target: () => state().target,
		error: () => state().error,
		setContainer: (element: HTMLDivElement) => {
			container = element;
		},
		consumeClick: (event: MouseEvent) => {
			return model.consume_click(event.detail);
		},
		onKeyDown: (event: KeyboardEvent, cwd: string) => {
			if (!event.altKey || !event.shiftKey) return;
			const direction =
				event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
			if (!direction) return;
			event.preventDefault();
			cancel?.();
			persistMove(
				model.keyboard(
					JSON.stringify(ordered().map((row) => row.cwd)),
					cwd,
					direction,
				),
			);
		},
		onPointerDown: (event: PointerEvent, cwd: string) => {
			if (event.button !== 0 || !event.isPrimary || !container) return;
			cancel?.();
			const tabs = container;
			const pointerId = event.pointerId;
			model.begin(cwd, event.clientX, event.clientY);
			let x = event.clientX;
			let y = event.clientY;
			let frame = 0;
			let lastTime = 0;
			const update = (elapsed = 0) => {
				const hit = JSON.parse(
					model.hit(
						JSON.stringify({
							rect: tabs.getBoundingClientRect(),
							x,
							y,
							cwd,
							elapsed,
							tabs: [
								...tabs.querySelectorAll<HTMLButtonElement>(
									"[data-repository-tab]",
								),
							].map((tab) => {
								const rect = tab.getBoundingClientRect();
								return {
									cwd: tab.dataset.repositoryTab,
									left: rect.left,
									width: rect.width,
								};
							}),
						}),
					),
				) as RepositoryTabDrag;
				tabs.scrollLeft += hit.scroll;
				sync();
			};
			const scroll = (time: number) => {
				update(lastTime ? Math.min(time - lastTime, 32) : 16);
				lastTime = time;
				frame = requestAnimationFrame(scroll);
			};
			const detach = () => {
				cancelAnimationFrame(frame);
				window.removeEventListener("pointermove", pointerMove);
				window.removeEventListener("pointerup", pointerUp);
				window.removeEventListener("pointercancel", pointerCancel);
				window.removeEventListener("keydown", onEscape);
				window.removeEventListener("blur", cleanup);
				cancel = undefined;
			};
			const cleanup = () => {
				detach();
				if (!disposed) {
					model.cancel();
					sync();
				}
			};
			const pointerMove = (next: PointerEvent) => {
				if (next.pointerId !== pointerId) return;
				x = next.clientX;
				y = next.clientY;
				const state = model.pointer_move(x, y);
				if (state === 0) return;
				next.preventDefault();
				if (state === 1) {
					sync();
					frame = requestAnimationFrame(scroll);
				}
				update();
			};
			const pointerUp = (next: PointerEvent) => {
				if (next.pointerId !== pointerId) return;
				x = next.clientX;
				y = next.clientY;
				if (model.active()) update();
				detach();
				persistMove(
					model.drop(JSON.stringify(ordered().map((row) => row.cwd))),
				);
			};
			const pointerCancel = (next: PointerEvent) => {
				if (next.pointerId === pointerId) cleanup();
			};
			const onEscape = (next: KeyboardEvent) => {
				if (next.key === "Escape") cleanup();
			};
			cancel = cleanup;
			window.addEventListener("pointermove", pointerMove, { passive: false });
			window.addEventListener("pointerup", pointerUp);
			window.addEventListener("pointercancel", pointerCancel);
			window.addEventListener("keydown", onEscape);
			window.addEventListener("blur", cleanup);
		},
	};
}
