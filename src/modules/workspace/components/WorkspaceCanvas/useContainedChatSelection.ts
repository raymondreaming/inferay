import { createEffect } from "solid-js";

/** Keeps a browser text selection within the chat pane where it began. */
export function useContainedChatSelection(
	active: () => boolean,
	container: () => HTMLElement | null,
) {
	createEffect(active, (isActive) => {
		if (!isActive) return;
		const containChatSelection = () => {
			const selection = window.getSelection();
			if (
				!selection ||
				selection.isCollapsed ||
				!selection.anchorNode ||
				!selection.focusNode
			)
				return;
			const anchor = selection.anchorNode;
			const pane = (
				anchor instanceof Element ? anchor : anchor.parentElement
			)?.closest("[data-chat-pane-id]");
			if (
				!pane ||
				!container()?.contains(pane) ||
				pane.contains(selection.focusNode)
			)
				return;
			const bounds = document.createRange();
			bounds.selectNodeContents(pane);
			const before =
				bounds.comparePoint(selection.focusNode, selection.focusOffset) < 0;
			selection.setBaseAndExtent(
				anchor,
				selection.anchorOffset,
				pane,
				before ? 0 : pane.childNodes.length,
			);
		};
		document.addEventListener("selectionchange", containChatSelection);
		return () =>
			document.removeEventListener("selectionchange", containChatSelection);
	});
}
