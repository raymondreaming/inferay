import { useCallback, useEffect, useState } from "octane";
import {
	fetchJson,
	postJson,
	sendJson,
} from "../../../adapters/backend/http.ts";
import { lacksObjectId } from "../../../shared/lib/data.ts";
import type { Prompt } from "../model/types.ts";

let promptsCache: Prompt[] | null = null;
let promptsPromise: Promise<Prompt[]> | null = null;
const promptListeners = new Set<() => void>();

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
	for (const listener of promptListeners) listener();
}

function arePromptsEqual(prev: Prompt[], next: Prompt[]) {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		const a = prev[i]!;
		const b = next[i]!;
		if (
			a._id !== b._id ||
			a.name !== b.name ||
			a.description !== b.description ||
			a.command !== b.command ||
			a.promptTemplate !== b.promptTemplate ||
			a.category !== b.category ||
			a.isBuiltIn !== b.isBuiltIn ||
			a.executionCount !== b.executionCount ||
			a.lastUsed !== b.lastUsed ||
			a.createdAt !== b.createdAt ||
			a.updatedAt !== b.updatedAt ||
			a.tags.length !== b.tags.length
		) {
			return false;
		}
		for (let j = 0; j < a.tags.length; j++) {
			if (a.tags[j] !== b.tags[j]) return false;
		}
	}
	return true;
}

export function preloadPrompts() {
	return loadPrompts().catch(() => []);
}

export function usePrompts(enabled = true) {
	const [prompts, setPrompts] = useState<Prompt[]>(() => promptsCache ?? []);
	const [loading, setLoading] = useState(!promptsCache);
	const [error, setError] = useState("");
	useEffect(() => {
		if (!enabled) return;
		const sync = () => setPrompts(promptsCache ?? []);
		promptListeners.add(sync);
		sync();
		return () => {
			promptListeners.delete(sync);
		};
	}, [enabled]);

	const reload = useCallback(async () => {
		const data = await loadPrompts();
		updatePromptsCache(data);
		setPrompts((current) => (arePromptsEqual(current, data) ? current : data));
	}, []);

	useEffect(() => {
		if (!enabled) return;
		let cancelled = false;
		loadPrompts()
			.then((data) => {
				if (cancelled) return;
				updatePromptsCache(data);
				setPrompts((current) =>
					arePromptsEqual(current, data) ? current : data,
				);
			})
			.catch((error) => {
				if (!cancelled)
					setError(
						error instanceof Error ? error.message : "Could not load skills",
					);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [enabled]);

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
			setPrompts((current) =>
				arePromptsEqual(current, updated) ? current : updated,
			);
			return next;
		},
		[],
	);

	const updatePrompt = useCallback(
		async (id: string, data: Record<string, unknown>) => {
			const response = await sendJson(`/api/prompts/${id}`, data, {
				method: "PUT",
			});
			if (!response.ok) {
				const failure = await response.json().catch(() => null);
				throw new Error(failure?.error ?? `Request failed: ${response.status}`);
			}
			const next = (await response.json()) as Prompt;
			const updated = promptsCache?.map((prompt) =>
				prompt._id === id ? next : prompt,
			) ?? [next];
			updatePromptsCache(updated);
			setPrompts((current) =>
				arePromptsEqual(current, updated) ? current : updated,
			);
			return next;
		},
		[],
	);

	const removePrompt = useCallback(async (id: string) => {
		const response = await fetch(`/api/prompts/${id}`, { method: "DELETE" });
		if (!response.ok) {
			throw new Error(`Request failed: ${response.status}`);
		}
		const updated = (promptsCache ?? []).filter(lacksObjectId.bind(null, id));
		updatePromptsCache(updated);
		setPrompts((current) =>
			arePromptsEqual(current, updated) ? current : updated,
		);
	}, []);

	const incrementUsage = useCallback(async (id: string) => {
		await postJson(`/api/prompts/${id}/usage`, {});
	}, []);

	return {
		prompts,
		loading,
		error,
		createPrompt,
		updatePrompt,
		removePrompt,
		incrementUsage,
		reload,
	};
}
