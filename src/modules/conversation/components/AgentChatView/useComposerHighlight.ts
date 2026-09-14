import { type Accessor, createEffect, createSignal, onSettled } from "solid-js";

export function useComposerHighlight(selected: Accessor<boolean>) {
	const [active, setActive] = createSignal(false);
	let frame = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const cancel = () => {
		cancelAnimationFrame(frame);
		clearTimeout(timer);
	};
	const highlight = () => {
		cancel();
		setActive(false);
		frame = requestAnimationFrame(() => {
			setActive(true);
			timer = setTimeout(() => {
				setActive(false);
			}, 1800);
		});
	};
	createEffect(selected, (selected) => {
		if (selected) return;
		cancel();
		setActive(false);
	});
	onSettled(() => cancel);
	return { active, highlight };
}
