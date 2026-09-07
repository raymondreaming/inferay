import { createEffect, createSignal, onSettled } from "solid-js";
/** Expensive data preparation begins only when its presentation is nearby. */
export function useNearViewport() {
	const ref = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const [visible, setVisible] = createSignal(
		typeof IntersectionObserver === "undefined",
	);
	onSettled(() => {
		if (!ref.current || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry) setVisible(entry.isIntersecting);
			},
			{
				rootMargin: "600px",
			},
		);
		observer.observe(ref.current);
		return () => observer.disconnect();
	});
	return {
		get ref() {
			return ref;
		},
		get visible() {
			return visible();
		},
	};
}
