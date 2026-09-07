import type { Accessor } from "solid-js";
import type { Prompt } from "../../../../build/presentation/contracts/Prompt.ts";
import { useBackgroundQuery as useQuery } from "../../../shared/hooks/useQueryResource.tsx";
import { queryClient } from "../../../shared/lib/dom.tsx";
import { fetchJson, postJson, sendJson } from "../../../shared/lib/native.tsx";
export function useSkills(
	_filter: Accessor<string> = () => "all",
	_search: Accessor<string> = () => "",
) {
	const query = useQuery(
		() => skillsQuery(_filter(), _search()),
		() => queryClient,
	);
	return {
		get skills() {
			return query.data ?? emptySkills;
		},
		get loading() {
			return query.isPending;
		},
		get error() {
			return query.error?.message ?? "";
		},
	};
}
const skillsKey = ["skills"] as const;
export const emptySkills: Prompt[] = [];
export const skillsQuery = (filter = "all", search = "") => ({
	queryKey: [...skillsKey, filter, search],
	queryFn: ({ signal }: { signal: AbortSignal }) =>
		fetchJson<Prompt[]>(
			`/api/prompts?${new URLSearchParams({
				filter,
				search,
			})}`,
			{
				signal,
			},
		),
});
async function refreshSkills() {
	await queryClient.cancelQueries({
		queryKey: skillsKey,
	});
	await queryClient.invalidateQueries({
		queryKey: skillsKey,
	});
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
	await fetchJson(`/api/prompts/${id}`, {
		method: "DELETE",
	});
	await refreshSkills();
}
export function preloadSkills() {
	return queryClient.prefetchQuery(skillsQuery());
}
export async function decideSkillProposal(
	messageId: string,
	proposal: import("../../../../build/presentation/contracts/SkillProposal.ts").SkillProposal,
	decision: "approve" | "reject",
) {
	const view = await postJson<
		import("../../../../build/presentation/contracts/SkillProposalView.ts").SkillProposalView
	>("/api/prompts/proposal", {
		messageId,
		proposal,
		decision,
	});
	await refreshSkills();
	return view;
}
