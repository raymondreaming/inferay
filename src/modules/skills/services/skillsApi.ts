import type { Prompt, SkillProposal, SkillProposalView } from "@contracts";
import { fetchJson, postJson, sendJson } from "@shared/lib/native.tsx";

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

export async function saveSkillRequest(
	data: Record<string, unknown>,
	id?: string,
) {
	const response = await sendJson(
		id ? `/api/prompts/${id}` : "/api/prompts",
		data,
		{ method: id ? "PUT" : "POST" },
	);
	if (!response.ok) {
		const failure = await response.json().catch(() => null);
		throw new Error(failure?.error ?? `Request failed: ${response.status}`);
	}
	return (await response.json()) as Prompt;
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
