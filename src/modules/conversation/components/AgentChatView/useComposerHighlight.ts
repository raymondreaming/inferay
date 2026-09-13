import { type Accessor, createEffect, createSignal, onSettled } from "solid-js";

export function useComposerHighlight(selected: Accessor<boolean>) {
	const [active, setActive] = createSignal(false);
	let frame = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const cancel = () => {
		cancelAnimationFrame(frame);
		clearTimeout(timer);
		frame = 0;
		timer = undefined;
	};
	const highlight = () => {
		cancel();
		setActive(false);
		frame = requestAnimationFrame(() => {
			frame = 0;
			setActive(true);
			timer = setTimeout(() => {
				timer = undefined;
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
