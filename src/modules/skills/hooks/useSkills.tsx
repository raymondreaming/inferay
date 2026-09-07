import { useQuery } from "@octanejs/tanstack-query";
import type { Prompt } from "../../../../build/presentation/contracts/Prompt.ts";
import { fetchJson, sendJson } from "../../../adapters/backend/http.ts";
import { queryClient } from "../../../shared/lib/data.ts";

export function useSkills(filter = "all", search = "") {
	const query = useQuery(skillsQuery(filter, search), queryClient);
	return {
		skills: query.data ?? emptySkills,
		loading: query.isPending,
		error: query.error?.message ?? "",
	};
}

const skillsKey = ["skills"] as const;
export const emptySkills: Prompt[] = [];
export const skillsQuery = (filter = "all", search = "") => ({
	queryKey: [...skillsKey, filter, search],
	queryFn: ({ signal }: { signal: AbortSignal }) =>
		fetchJson<Prompt[]>(
			`/api/prompts?${new URLSearchParams({ filter, search })}`,
			{ signal },
		),
});
async function refreshSkills() {
	await queryClient.cancelQueries({ queryKey: skillsKey });
	await queryClient.invalidateQueries({ queryKey: skillsKey });
}
export async function saveSkill(data: Record<string, unknown>, id?: string) {
	const response = await sendJson(
		id ? `/api/prompts/${id}` : "/api/prompts",
		data,
		{
			method: id ? "PUT" : "POST",
		},
	);
	if (!response.ok) {
		const failure = await response.json().catch(() => null);
		throw new Error(failure?.error ?? `Request failed: ${response.status}`);
	}
	const skill = (await response.json()) as Prompt;
	await refreshSkills();
	return skill;
}
export async function removeSkill(id: string) {
	await fetchJson(`/api/prompts/${id}`, { method: "DELETE" });
	await refreshSkills();
}
export function preloadSkills() {
	return queryClient.prefetchQuery(skillsQuery());
}
