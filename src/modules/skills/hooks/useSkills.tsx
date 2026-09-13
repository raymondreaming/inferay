import type { Prompt, SkillProposal } from "@contracts";
import { useBackgroundQuery as useQuery } from "@shared/hooks/useQueryResource.tsx";
import { queryClient } from "@shared/lib/dom.tsx";
import {
	decideSkillProposalRequest,
	loadSkills,
	removeSkillRequest,
	saveSkillRequest,
} from "@skills/services/skillsApi.ts";
import type { Accessor } from "solid-js";
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
		loadSkills(filter, search, signal),
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
	const skill = await saveSkillRequest(data, id);
	await refreshSkills();
	return skill;
}
export async function removeSkill(id: string) {
	await removeSkillRequest(id);
	await refreshSkills();
}
export function preloadSkills() {
	return queryClient.prefetchQuery(skillsQuery());
}
export async function decideSkillProposal(
	messageId: string,
	proposal: SkillProposal,
	decision: "approve" | "reject",
) {
	const view = await decideSkillProposalRequest(messageId, proposal, decision);
	await refreshSkills();
	return view;
}
