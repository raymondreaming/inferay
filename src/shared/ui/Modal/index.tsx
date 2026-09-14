import { iconSize, surfaceStyles } from "@design-system/styles.stylex.ts";
import { APP_REGION_NO_DRAG_CLASS } from "@shared/lib/dom.tsx";
import { IconButton } from "@shared/ui/IconButton/index.tsx";
import { IconX } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { type Element, onSettled } from "solid-js";
import { styles } from "./styles.ts";

/** Mount while open. The caller owns dismissal guards and feature state. */
export function Modal(props: {
	label: string;
	onClose: () => void;
	closeDisabled?: boolean;
	class?: string;
	children: Element;
}) {
	let dialog: HTMLDialogElement | undefined;
	let pressedBackdrop = false;
	onSettled(() => {
		const previousFocus = document.activeElement;
		dialog?.showModal();
		return () => {
			dialog?.close();
			if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
				previousFocus.focus();
		};
	});
	const outside = (event: MouseEvent) => {
		const bounds = dialog!.getBoundingClientRect();
		return (
			event.target === dialog &&
			(event.clientX < bounds.left ||
				event.clientX > bounds.right ||
				event.clientY < bounds.top ||
				event.clientY > bounds.bottom)
		);
	};
	return (
		// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Native modal dialog owns Escape and clicks on its backdrop.
		<dialog
			ref={(element) => (dialog = element)}
			aria-label={props.label}
			onCancel={(event) => {
				event.preventDefault();
				props.onClose();
			}}
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === "Escape" && !event.defaultPrevented) {
					event.preventDefault();
					props.onClose();
				}
			}}
			onPointerDown={(event) => {
				pressedBackdrop = outside(event);
			}}
			onClick={(event) => {
				if (pressedBackdrop && outside(event)) props.onClose();
				pressedBackdrop = false;
			}}
			class={`${APP_REGION_NO_DRAG_CLASS} ${stylex.attrs(surfaceStyles.overlay, styles.dialog).class ?? ""} ${props.class ?? ""}`}
		>
			{props.children}
			<IconButton
				type="button"
				variant="ghost"
				size="sm"
				aria-label={`Close ${props.label.toLowerCase()}`}
				title={`Close ${props.label.toLowerCase()}`}
				onClick={props.onClose}
				disabled={props.closeDisabled}
				class={stylex.attrs(styles.close).class}
			>
				<IconX size={iconSize.md} />
			</IconButton>
		</dialog>
	);
}
