import type { Prompt, SkillProposal, SkillProposalView } from "@contracts";
import { fetchJson, postJson } from "@shared/lib/native.tsx";

export function loadSkills(
	filter: string,
	search: string,
	signal?: AbortSignal,
) {
	return fetchJson<Prompt[]>(
		`/api/prompts?${new URLSearchParams({ filter, search })}`,
		{ signal },
	);
}

export function saveSkillRequest(data: Record<string, unknown>, id?: string) {
	return postJson<Prompt>(
		id ? `/api/prompts/${id}` : "/api/prompts",
		data,
		{ method: id ? "PUT" : "POST" },
		{ server: true },
	);
}

export function removeSkillRequest(id: string) {
	return fetchJson(`/api/prompts/${id}`, { method: "DELETE" });
}

export function previewSkillProposal(
	input: { messageId: string; proposal: SkillProposal },
	signal?: AbortSignal,
) {
	return postJson<SkillProposalView>("/api/prompts/proposal", input, {
		signal,
	});
}

export function decideSkillProposalRequest(
	messageId: string,
	proposal: SkillProposal,
	decision: "approve" | "reject",
) {
	return postJson<SkillProposalView>("/api/prompts/proposal", {
		messageId,
		proposal,
		decision,
	});
}
