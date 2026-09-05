import { useQuery } from "@octanejs/tanstack-query";
import {
	fetchJson,
	postJson,
	sendJson,
} from "../../../adapters/backend/http.ts";
import { queryClient } from "../../../shared/lib/query-client.ts";
import type { Skill } from "../model/skill-library.ts";

const skillsKey = ["skills"] as const;
const emptySkills: Skill[] = [];
const skillsQuery = {
	queryKey: skillsKey,
	queryFn: ({ signal }: { signal: AbortSignal }) =>
		fetchJson<Skill[]>("/api/prompts", { signal }),
};

async function saveSkillToCache(skill: Skill) {
	// An older list request must not overwrite an approved change.
	await queryClient.cancelQueries({ queryKey: skillsKey });
	queryClient.setQueryData<Skill[]>(skillsKey, (current = []) =>
		current.some((item) => item._id === skill._id)
			? current.map((item) => (item._id === skill._id ? skill : item))
			: [skill, ...current],
	);
}

async function createSkill(
	data: Pick<Skill, "name" | "command" | "description" | "promptTemplate"> &
		Partial<Pick<Skill, "category" | "tags">>,
) {
	const skill = await postJson<Skill>("/api/prompts", data);
	await saveSkillToCache(skill);
	return skill;
}

async function updateSkill(id: string, data: Record<string, unknown>) {
	const response = await sendJson(`/api/prompts/${id}`, data, {
		method: "PUT",
	});
	if (!response.ok) {
		const failure = await response.json().catch(() => null);
		throw new Error(failure?.error ?? `Request failed: ${response.status}`);
	}
	const skill = (await response.json()) as Skill;
	await saveSkillToCache(skill);
	return skill;
}

async function removeSkill(id: string) {
	await fetchJson(`/api/prompts/${id}`, { method: "DELETE" });
	await queryClient.cancelQueries({ queryKey: skillsKey });
	queryClient.setQueryData<Skill[]>(skillsKey, (current = []) =>
		current.filter((skill) => skill._id !== id),
	);
}

export function preloadSkills() {
	return queryClient.prefetchQuery(skillsQuery);
}

export function useSkills(enabled: boolean) {
	const query = useQuery({ ...skillsQuery, enabled }, queryClient);
	return {
		skills: query.data ?? emptySkills,
		loading: query.isPending,
		error: query.error?.message ?? "",
		createSkill,
		updateSkill,
		removeSkill,
	};
}
