import type { Prompt, SkillProposal, SkillProposalView } from "@contracts";
import { queryClient } from "@shared/lib/dom.tsx";
import { fetchJson, postJson } from "@shared/lib/native.tsx";

const skillsKey = ["skills"] as const;
export const skillsQuery = () => ({
	queryKey: skillsKey,
	queryFn: ({ signal }: { signal: AbortSignal }) =>
		fetchJson<Prompt[]>("/api/prompts", { signal }),
});
export const preloadSkills = () => queryClient.prefetchQuery(skillsQuery());
async function refreshSkills() {
	await queryClient.cancelQueries({ queryKey: skillsKey });
	await queryClient.invalidateQueries({ queryKey: skillsKey });
}

export async function saveSkill(data: unknown, id?: string) {
	const skill = await postJson<Prompt>(
		id ? `/api/prompts/${id}` : "/api/prompts",
		data,
		{ method: id ? "PUT" : "POST" },
		{ server: true },
	);
	await refreshSkills();
	return skill;
}

export async function removeSkill(id: string) {
	await fetchJson(`/api/prompts/${id}`, { method: "DELETE" });
	await refreshSkills();
}

export function previewSkillProposal(
	input: { messageId: string; proposal: SkillProposal },
	signal?: AbortSignal,
) {
	return postJson<SkillProposalView>("/api/prompts/proposal", input, {
		signal,
	});
}

export async function decideSkillProposal(
	messageId: string,
	proposal: SkillProposal,
	decision: "approve" | "reject",
) {
	const result = await postJson<SkillProposalView>("/api/prompts/proposal", {
		messageId,
		proposal,
		decision,
	});
	await refreshSkills();
	return result;
}
