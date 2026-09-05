export function listenWindowEvent<K extends keyof WindowEventMap | string>(
	type: K,
	listener: K extends keyof WindowEventMap
		? (event: WindowEventMap[K]) => void
		: EventListenerOrEventListenerObject,
): () => void {
	const eventListener = listener as EventListenerOrEventListenerObject;
	window.addEventListener(type, eventListener);
	return window.removeEventListener.bind(
		window,
		type,
		eventListener,
	) as () => void;
}

export function stopPropagation(event: Event): void {
	event.stopPropagation();
}

export function activateOnEnterOrSpacePreventDefault(
	action: () => void,
	event: KeyboardEvent,
): void {
	if (event.key !== "Enter" && event.key !== " ") return;
	event.preventDefault();
	action();
}

export function setInputValue(
	setValue: (value: string) => void,
	event: InputEvent & {
		currentTarget: HTMLInputElement | HTMLTextAreaElement;
	},
): void {
	setValue(event.currentTarget.value);
}

export function setupAgentThemePanelShortcut(
	setShowSettings: (show: boolean) => void,
): () => void {
	return listenWindowEvent(
		"agent-open-theme-panel",
		setShowSettings.bind(null, true),
	);
}
