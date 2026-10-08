import { memoryTitle, saveMemoryNote } from "@shared/services/memoryApi.ts";
import { createSignal, onSettled } from "solid-js";
import { importProjectDocument } from "../../../services/projectsApi.ts";

export function useMemoryDrop(
	projectId: () => string,
	refresh: () => Promise<unknown>,
) {
	const [dropping, setDropping] = createSignal(false);
	const [adding, setAdding] = createSignal("");
	const addToMemory = async (files: File[], text: string) => {
		if (!files.length && !text.trim()) return;
		setAdding(files.length > 1 ? `Saving ${files.length} items…` : "Saving…");
		try {
			for (const file of files) await importProjectDocument(projectId(), file);
			if (!files.length)
				await saveMemoryNote(
					{ projectId: projectId() },
					{
						title: memoryTitle(text),
						body: text,
						tags: [],
						source: "manual",
						supersedes: null,
						expires: null,
					},
				);
			await refresh();
			setAdding("Saved to memory");
		} catch (error) {
			setAdding(error instanceof Error ? error.message : "Could not save");
		}
		setTimeout(() => setAdding(""), 1800);
	};
	onSettled(() => {
		const paste = (event: ClipboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (target?.closest("input, textarea, [contenteditable='true']")) return;
			const data = event.clipboardData;
			if (!data || (!data.files.length && !data.getData("text/plain").trim()))
				return;
			event.preventDefault();
			void addToMemory([...data.files], data.getData("text/plain"));
		};
		document.addEventListener("paste", paste);
		return () => document.removeEventListener("paste", paste);
	});
	return { dropping, setDropping, adding, addToMemory };
}
