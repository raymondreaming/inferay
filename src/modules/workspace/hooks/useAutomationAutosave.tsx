import type { ProjectCommand } from "@contracts";
import { createEffect, createSignal, onSettled } from "solid-js";

export function useAutomationAutosave(
	enabled: () => boolean,
	draft: () => ProjectCommand,
	save: (command: ProjectCommand) => Promise<void>,
	setError: (message: string) => void,
) {
	const fingerprint = () =>
		JSON.stringify({ ...draft(), expectedRevision: null });
	let savedDraft = fingerprint();
	let saving: Promise<boolean> | undefined;
	const [savingEdits, setSavingEdits] = createSignal(false);
	async function flush(): Promise<boolean> {
		if (saving) return saving;
		saving = (async () => {
			setSavingEdits(true);
			setError("");
			try {
				while (fingerprint() !== savedDraft) {
					const snapshot = fingerprint();
					await save(draft());
					savedDraft = snapshot;
				}
				return true;
			} catch (error) {
				setError(String(error));
				return false;
			} finally {
				setSavingEdits(false);
				saving = undefined;
			}
		})();
		const result = await saving;
		saving = undefined;
		return result;
	}
	createEffect(
		() => {
			try {
				return fingerprint();
			} catch {
				return null;
			}
		},
		(snapshot) => {
			if (!enabled() || snapshot === savedDraft || !snapshot) return;
			const timer = setTimeout(() => {
				void flush();
			}, 600);
			return () => clearTimeout(timer);
		},
	);
	onSettled(() => () => {
		if (enabled()) void flush();
	});
	return { flush, savingEdits };
}
