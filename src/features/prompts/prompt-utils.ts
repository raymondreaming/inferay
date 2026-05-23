interface FilterablePrompt {
	name: string;
	command: string;
	description: string;
	category?: string;
	isBuiltIn?: boolean;
}

export function filterPrompts<T extends FilterablePrompt>(
	prompts: readonly T[],
	filter: string,
	search: string
): T[] {
	const q = search.toLowerCase();
	const filtered: T[] = [];
	for (const prompt of prompts) {
		if (filter !== "all") {
			if (filter === "builtin" && !prompt.isBuiltIn) continue;
			if (filter === "custom" && prompt.isBuiltIn) continue;
			if (
				filter !== "builtin" &&
				filter !== "custom" &&
				prompt.category !== filter
			)
				continue;
		}
		if (
			q &&
			!prompt.name.toLowerCase().includes(q) &&
			!prompt.command.toLowerCase().includes(q) &&
			!prompt.description.toLowerCase().includes(q)
		)
			continue;
		filtered.push(prompt);
	}
	return filtered;
}
