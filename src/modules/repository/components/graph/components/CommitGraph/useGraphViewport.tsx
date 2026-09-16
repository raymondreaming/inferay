import { readStoredJson, writeStoredJson } from "@shared/lib/native.tsx";
import { type Accessor, createEffect, createSignal } from "solid-js";

const scrollKey = (repository?: string) =>
	`commit-graph-scroll-v1:${repository ?? "default"}`;

/** Own scrolling and persistence together, so teardown retains the old repository. */
export function useGraphViewport(
	repository: Accessor<string | undefined>,
	hasRows: Accessor<boolean>,
	rowHeight: number,
) {
	const [element, setElement] = createSignal<HTMLDivElement | null>(null);
	const [scrollTop, setScrollTop] = createSignal(0);
	const [viewportHeight, setViewportHeight] = createSignal(600);
	const [viewportWidth, setViewportWidth] = createSignal(0);
	let remember = (_top: number, _left: number) => {};
	createEffect(
		() => [repository(), element(), hasRows()] as const,
		([repository, scroller, ready]) => {
			if (!scroller || !ready) return;
			const key = scrollKey(repository);
			const saved = readStoredJson<{ top?: number; left?: number }>(key, {});
			let position = { top: saved.top ?? 0, left: saved.left ?? 0 };
			let frame = 0;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const persist = () => writeStoredJson(key, position);
			scroller.scrollTop = position.top;
			scroller.scrollLeft = position.left;
			setScrollTop(position.top);
			const measure = () => {
				setViewportHeight(scroller.clientHeight);
				setViewportWidth(scroller.clientWidth);
			};
			measure();
			const observer = new ResizeObserver(measure);
			observer.observe(scroller);
			remember = (top, left) => {
				position = { top, left };
				if (!frame)
					frame = requestAnimationFrame(() => {
						frame = 0;
						setScrollTop((current) =>
							Math.floor(current / rowHeight) ===
							Math.floor(position.top / rowHeight)
								? current
								: position.top,
						);
					});
				clearTimeout(timer);
				timer = setTimeout(persist, 160);
			};
			return () => {
				remember = () => {};
				cancelAnimationFrame(frame);
				clearTimeout(timer);
				observer.disconnect();
				persist();
			};
		},
	);
	return {
		scrollerRef: {
			get current() {
				return element();
			},
			set current(value: HTMLDivElement | null) {
				setElement(value);
			},
		},
		scrollTop,
		viewportHeight,
		viewportWidth,
		rememberScroll: (top: number, left: number) => remember(top, left),
	};
}
