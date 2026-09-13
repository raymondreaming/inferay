import { type Accessor, createEffect, onSettled } from "solid-js";
import type { RefCell } from "../../../../shared/lib/dom.tsx";

/** Create in the composer owner; the directive only captures its DOM node. */
export function useComposerTextarea(options: {
	input: Accessor<string>;
	active: Accessor<boolean>;
	textareaRef: Accessor<RefCell<HTMLTextAreaElement | null>>;
	overlayRef: Accessor<RefCell<HTMLDivElement | null>>;
}) {
	let textarea: HTMLTextAreaElement | undefined;
	createEffect(
		() => [options.input(), options.active()] as const,
		([input, active]) => {
			if (!active || !textarea) return;
			textarea.style.height = "20px";
			if (input)
				textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 20), 120)}px`;
			const overlay = options.overlayRef().current;
			if (overlay)
				overlay.style.transform = `translateY(-${textarea.scrollTop}px)`;
		},
	);
	onSettled(() => {
		const ref = options.textareaRef();
		const overlayRef = options.overlayRef();
		const overlay = overlayRef.current;
		return () => {
			if (ref.current === textarea) ref.current = null;
			if (overlayRef.current === overlay) overlayRef.current = null;
		};
	});
	return (element: HTMLTextAreaElement) => {
		textarea = element;
		options.textareaRef().current = element;
	};
}
