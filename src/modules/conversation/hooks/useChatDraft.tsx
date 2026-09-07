import { type Accessor, createSignal, onSettled } from "solid-js";
import {
	loadStoredInput,
	saveStoredInput,
} from "../../../shared/lib/native.tsx";

/** Pending saves retain the pane that was edited, even after navigation. */
export function useChatDraft(paneId: Accessor<string>) {
	const pending = new Map<string, string>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const [input, setInputValue] = createSignal(() => {
		const id = paneId();
		return pending.get(id) ?? loadStoredInput(id);
	});
	const flushSave = () => {
		clearTimeout(timer);
		timer = undefined;
		for (const [id, text] of pending) saveStoredInput(id, text);
		pending.clear();
	};
	onSettled(() => flushSave);
	const setInput = (text: string) => {
		pending.set(paneId(), text);
		setInputValue(text);
		if (timer === undefined) timer = setTimeout(flushSave, 250);
	};
	return { input, setInput };
}
