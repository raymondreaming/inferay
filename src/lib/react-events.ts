import type React from "react";

export function listenWindowEvent<K extends keyof WindowEventMap | string>(
	type: K,
	listener: K extends keyof WindowEventMap
		? (event: WindowEventMap[K]) => void
		: EventListenerOrEventListenerObject
): () => void {
	const eventListener = listener as EventListenerOrEventListenerObject;
	window.addEventListener(type, eventListener);
	return window.removeEventListener.bind(
		window,
		type,
		eventListener
	) as () => void;
}

export function listenDocumentEvent<K extends keyof DocumentEventMap | string>(
	type: K,
	listener: K extends keyof DocumentEventMap
		? (event: DocumentEventMap[K]) => void
		: EventListenerOrEventListenerObject
): () => void {
	const eventListener = listener as EventListenerOrEventListenerObject;
	document.addEventListener(type, eventListener);
	return document.removeEventListener.bind(
		document,
		type,
		eventListener
	) as () => void;
}

export function stopPropagation(event: React.SyntheticEvent): void {
	event.stopPropagation();
}

export function stopPropagationAndCall(
	action: () => void,
	event: React.SyntheticEvent
): void {
	event.stopPropagation();
	action();
}

export function activateOnEnterOrSpace(
	action: () => void,
	event: React.KeyboardEvent
): void {
	if (event.key === "Enter" || event.key === " ") action();
}

export function activateOnEnterOrSpacePreventDefault(
	action: () => void,
	event: React.KeyboardEvent
): void {
	if (event.key !== "Enter" && event.key !== " ") return;
	event.preventDefault();
	action();
}

export function setInputValue(
	setValue: (value: string) => void,
	event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
): void {
	setValue(event.target.value);
}

export function focusRef<T extends { focus(): void }>(ref: {
	current: T | null;
}): void {
	ref.current?.focus();
}
