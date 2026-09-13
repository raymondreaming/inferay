import type { RepositoryWorkspace } from "@contracts";
import { type Accessor, createMemo, createSignal, onCleanup } from "solid-js";

export function useRepositoryTabDrag(
	workspaces: Accessor<RepositoryWorkspace[]>,
	persist: (cwd: string, beforeCwd: string | null) => Promise<unknown>,
) {
	const [pendingOrder, setPendingOrder] = createSignal<string[] | null>(null);
	const [dragging, setDragging] = createSignal<string | null>(null);
	const [target, setTarget] = createSignal<{ before: string | null } | null>(
		null,
	);
	const [error, setError] = createSignal("");
	const ordered = createMemo(() => {
		const rows = workspaces();
		const order = pendingOrder();
		if (!order) return rows;
		const ranks = new Map(order.map((cwd, index) => [cwd, index]));
		return [...rows].sort(
			(a, b) =>
				(ranks.get(a.cwd) ?? order.length) - (ranks.get(b.cwd) ?? order.length),
		);
	});
	let container: HTMLDivElement | undefined;
	let cancel: (() => void) | undefined;
	let suppressClick = false;
	let disposed = false;
	let request = 0;
	onCleanup(() => {
		disposed = true;
		cancel?.();
	});
	const move = (cwd: string, before: string | null) => {
		const current = ordered().map((row) => row.cwd);
		if (!current.includes(cwd) || before === cwd) return;
		const next = current.filter((path) => path !== cwd);
		const index = before === null ? next.length : next.indexOf(before);
		if (index < 0) return;
		next.splice(index, 0, cwd);
		if (next.every((path, i) => path === current[i])) return;
		const id = ++request;
		setPendingOrder(next);
		setError("");
		void persist(cwd, before)
			.then((saved) => {
				if (!disposed && id === request && !saved)
					setError("Tab order could not be saved. Please try again.");
			})
			.catch(() => {
				if (!disposed && id === request)
					setError("Tab order could not be saved. Please try again.");
			})
			.finally(() => {
				if (!disposed && id === request) setPendingOrder(null);
			});
	};
	return {
		ordered,
		dragging,
		target,
		error,
		setContainer: (element: HTMLDivElement) => {
			container = element;
		},
		consumeClick: (event: MouseEvent) => {
			const suppressed = suppressClick && event.detail !== 0;
			suppressClick = false;
			return suppressed;
		},
		onKeyDown: (event: KeyboardEvent, cwd: string) => {
			if (!event.altKey || !event.shiftKey) return;
			const direction =
				event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
			if (!direction) return;
			event.preventDefault();
			cancel?.();
			const rows = ordered();
			const from = rows.findIndex((row) => row.cwd === cwd);
			const to = from + direction;
			if (from < 0 || to < 0 || to >= rows.length) return;
			move(cwd, rows[direction < 0 ? to : to + 1]?.cwd ?? null);
		},
		onPointerDown: (event: PointerEvent, cwd: string) => {
			if (event.button !== 0 || !event.isPrimary || !container) return;
			cancel?.();
			suppressClick = false;
			const tabs = container;
			const pointerId = event.pointerId;
			const startX = event.clientX;
			const startY = event.clientY;
			let x = startX;
			let y = startY;
			let active = false;
			let before: string | null = null;
			let valid = false;
			let frame = 0;
			let lastTime = 0;
			const update = () => {
				const bounds = tabs.getBoundingClientRect();
				valid =
					x >= bounds.left - 24 &&
					x <= bounds.right + 24 &&
					y >= bounds.top - 24 &&
					y <= bounds.bottom + 24;
				const others = Array.from(
					tabs.querySelectorAll<HTMLButtonElement>("[data-repository-tab]"),
				).filter((tab) => tab.dataset.repositoryTab !== cwd);
				before =
					others.find((tab) => {
						const rect = tab.getBoundingClientRect();
						return x < rect.left + rect.width / 2;
					})?.dataset.repositoryTab ?? null;
				setTarget(valid ? { before } : null);
			};
			const scroll = (time: number) => {
				const elapsed = lastTime ? Math.min(time - lastTime, 32) : 16;
				lastTime = time;
				const rect = tabs.getBoundingClientRect();
				const edge = Math.min(40, rect.width / 3);
				if (valid && edge > 0) {
					const speed =
						x < rect.left + edge
							? -Math.min(1, (rect.left + edge - x) / edge)
							: x > rect.right - edge
								? Math.min(1, (x - rect.right + edge) / edge)
								: 0;
					tabs.scrollLeft += speed * elapsed * 0.6;
				}
				update();
				frame = requestAnimationFrame(scroll);
			};
			const cleanup = () => {
				cancelAnimationFrame(frame);
				window.removeEventListener("pointermove", pointerMove);
				window.removeEventListener("pointerup", pointerUp);
				window.removeEventListener("pointercancel", pointerCancel);
				window.removeEventListener("keydown", onEscape);
				window.removeEventListener("blur", cleanup);
				cancel = undefined;
				if (!disposed) {
					setDragging(null);
					setTarget(null);
				}
			};
			const pointerMove = (next: PointerEvent) => {
				if (next.pointerId !== pointerId) return;
				x = next.clientX;
				y = next.clientY;
				if (!active && Math.hypot(x - startX, y - startY) < 5) return;
				next.preventDefault();
				if (!active) {
					active = true;
					suppressClick = true;
					setDragging(cwd);
					frame = requestAnimationFrame(scroll);
				}
				update();
			};
			const pointerUp = (next: PointerEvent) => {
				if (next.pointerId !== pointerId) return;
				x = next.clientX;
				y = next.clientY;
				if (active) update();
				cleanup();
				if (active && valid) move(cwd, before);
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
