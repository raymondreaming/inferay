import { useQuery } from "@octanejs/tanstack-query";
import { fetchJson, sendJson } from "../../../adapters/backend/http.ts";
import { queryClient } from "../../../shared/lib/data.ts";
import type { Skill } from "../model/skill-library.ts";

const skillsKey = ["skills"] as const;
const emptySkills: Skill[] = [];
const skillsQuery = (filter = "all", search = "") => ({
	queryKey: [...skillsKey, filter, search],
	queryFn: ({ signal }: { signal: AbortSignal }) =>
		fetchJson<Skill[]>(
			`/api/prompts?${new URLSearchParams({ filter, search })}`,
			{ signal },
		),
});

async function refreshSkills() {
	await queryClient.cancelQueries({ queryKey: skillsKey });
	await queryClient.invalidateQueries({ queryKey: skillsKey });
}

async function createSkill(
	data: Pick<Skill, "name" | "command" | "description" | "promptTemplate"> &
		Partial<Pick<Skill, "category">> & { tags?: string | string[] },
) {
	return saveSkill("/api/prompts", data, "POST");
}

async function updateSkill(id: string, data: Record<string, unknown>) {
	return saveSkill(`/api/prompts/${id}`, data, "PUT");
}

async function saveSkill(url: string, data: unknown, method: "POST" | "PUT") {
	const response = await sendJson(url, data, { method });
	if (!response.ok) {
		const failure = await response.json().catch(() => null);
		throw new Error(failure?.error ?? `Request failed: ${response.status}`);
	}
	const skill = (await response.json()) as Skill;
	await refreshSkills();
	return skill;
}

async function removeSkill(id: string) {
	await fetchJson(`/api/prompts/${id}`, { method: "DELETE" });
	await refreshSkills();
}

export function preloadSkills() {
	return queryClient.prefetchQuery(skillsQuery());
}

export function useSkills(enabled: boolean, filter = "all", search = "") {
	const query = useQuery(
		{ ...skillsQuery(filter, search), enabled },
		queryClient,
	);
	return {
		skills: query.data ?? emptySkills,
		loading: query.isPending,
		error: query.error?.message ?? "",
		createSkill,
		updateSkill,
		removeSkill,
	};
}
