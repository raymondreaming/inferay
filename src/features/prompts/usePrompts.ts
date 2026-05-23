import { useCallback, useEffect, useState } from "react";
import { fetchJson, postJson, sendJson } from "../../lib/fetch-json.ts";
import { lacksObjectId } from "../../lib/data.ts";
import type { Prompt } from "./types.ts";

let promptsCache: Prompt[] | null = null;
let promptsPromise: Promise<Prompt[]> | null = null;

async function loadPrompts(): Promise<Prompt[]> {
	if (promptsCache) return promptsCache;
	if (promptsPromise) return promptsPromise;
	promptsPromise = fetchJson<Prompt[]>("/api/prompts")
		.then((data) => {
			promptsCache = data;
			return data;
		})
		.finally(() => {
			promptsPromise = null;
		});
	return promptsPromise;
}

function updatePromptsCache(prompts: Prompt[]) {
	promptsCache = prompts;
}

export function preloadPrompts() {
	return loadPrompts().catch(() => []);
}

export function usePrompts() {
	const [prompts, setPrompts] = useState<Prompt[]>(() => promptsCache ?? []);

	const reload = useCallback(async () => {
		const data = await loadPrompts();
		updatePromptsCache(data);
		setPrompts(data);
	}, []);

	useEffect(() => {
		reload();
	}, [reload]);

	const createPrompt = useCallback(
		async (data: {
			name: string;
			command: string;
			description: string;
			promptTemplate: string;
			category?: string;
			tags?: string[];
		}) => {
			const next = await postJson<Prompt>("/api/prompts", data);
			const updated = promptsCache ? [next, ...promptsCache] : [next];
			updatePromptsCache(updated);
			setPrompts(updated);
		},
		[]
	);

	const updatePrompt = useCallback(
		async (id: string, data: Record<string, unknown>) => {
			const response = await sendJson(`/api/prompts/${id}`, data, {
				method: "PUT",
			});
			if (!response.ok) {
				throw new Error(`Request failed: ${response.status}`);
			}
			const next = (await response.json()) as Prompt;
			const updated = promptsCache?.map((prompt) =>
				prompt._id === id ? next : prompt
			) ?? [next];
			updatePromptsCache(updated);
			setPrompts(updated);
		},
		[]
	);

	const removePrompt = useCallback(async (id: string) => {
		const response = await fetch(`/api/prompts/${id}`, { method: "DELETE" });
		if (!response.ok) {
			throw new Error(`Request failed: ${response.status}`);
		}
		const updated = (promptsCache ?? []).filter(lacksObjectId.bind(null, id));
		updatePromptsCache(updated);
		setPrompts(updated);
	}, []);

	const incrementUsage = useCallback(async (id: string) => {
		await postJson(`/api/prompts/${id}/usage`, {});
	}, []);

	return {
		prompts,
		createPrompt,
		updatePrompt,
		removePrompt,
		incrementUsage,
		reload,
	};
}
