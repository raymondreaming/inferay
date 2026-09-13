import { type Accessor, createEffect, createSignal } from "solid-js";

export function useImageDrop(
	enabled: Accessor<boolean>,
	drop: (event: DragEvent) => Promise<void>,
) {
	const [active, setActive] = createSignal(false);
	let depth = 0;
	const reset = () => {
		depth = 0;
		setActive(false);
	};
	createEffect(enabled, (enabled) => {
		if (!enabled) reset();
	});
	return {
		active,
		handlers: {
			onDragEnter(event: DragEvent) {
				if (!enabled() || !event.dataTransfer) return;
				if (
					!Array.from(event.dataTransfer.items).some(
						(item) => item.kind === "file" && item.type.startsWith("image/"),
					)
				)
					return;
				event.preventDefault();
				event.stopPropagation();
				depth++;
				setActive(true);
			},
			onDragOver(event: DragEvent) {
				if (!depth) return;
				event.preventDefault();
				event.stopPropagation();
				if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
			},
			onDragLeave(event: DragEvent) {
				if (!depth) return;
				event.stopPropagation();
				depth = Math.max(0, depth - 1);
				if (!depth) setActive(false);
			},
			onDrop(event: DragEvent) {
				if (!depth) return;
				event.stopPropagation();
				reset();
				void drop(event);
			},
		},
	};
}
