import type { AgentContextLayer as NativeContextLayer } from "../../../../build/presentation/contracts/AgentContextLayer.ts";
import type { EffectiveAgentContext as NativeEffectiveContext } from "../../../../build/presentation/contracts/EffectiveAgentContext.ts";
import type { Prompt as NativeSkill } from "../../../../build/presentation/contracts/Prompt.ts";
import { fetchJson, sendJson } from "../../../adapters/backend/http.ts";
import { project as rustProject } from "../../../adapters/presentation/model.ts";
import { dispatchWindowEvent, queryClient } from "../../../shared/lib/data.ts";
export type AgentContextMode = "inherit" | "replace";
type AgentContextLayer = Omit<NativeContextLayer, "mode"> & {
	mode: AgentContextMode;
};
export type EffectiveAgentContext = Omit<
	NativeEffectiveContext,
	"global" | "project" | "chat"
> & {
	global: AgentContextLayer;
	project: AgentContextLayer | null;
	chat: AgentContextLayer | null;
};
export interface AgentContextUpdate {
	scope: "global" | "project" | "chat";
	cwd?: string;
	paneId?: string;
	instructions: string;
	mode?: AgentContextMode;
}
export const OPEN_SETTINGS_MODAL_EVENT = "inferay-open-settings-modal";
export type SettingsModalTarget =
	| "agents"
	| "appearance"
	| "workspace"
	| "github";
export interface OpenSettingsModalDetail {
	readonly section: SettingsModalTarget;
}
export function openSettingsModal(
	section: SettingsModalTarget = "agents",
): void {
	dispatchWindowEvent<OpenSettingsModalDetail>(OPEN_SETTINGS_MODAL_EVENT, {
		section,
	});
}
export const OPEN_SKILLS_EVENT = "inferay-open-skills";
export type SkillsTarget =
	| { mode: "browse" }
	| { mode: "create" }
	| { mode: "edit"; skillId: string };
export function openSkills(
	target: SkillsTarget = {
		mode: "browse",
	},
): void {
	dispatchWindowEvent(OPEN_SKILLS_EVENT, target);
}
export interface SkillProposal {
	type: "inferay.skill-proposal";
	action: "create" | "update";
	skillId?: string;
	expectedUpdatedAt?: number;
	name: string;
	command: string;
	description: string;
	promptTemplate: string;
	reason: string;
}
export interface SkillRead {
	_id: string;
	name: string;
	command: string;
	description: string;
	promptTemplate: string;
	isBuiltIn: boolean;
}
export type Skill = NativeSkill;
export interface SkillFormState {
	name: string;
	command: string;
	description: string;
	promptTemplate: string;
	error: string;
	isSaving: boolean;
	isEditing: boolean;
	isCreating: boolean;
}
export const INITIAL_SKILL_FORM: SkillFormState = {
	name: "",
	command: "",
	description: "",
	promptTemplate: "",
	error: "",
	isSaving: false,
	isEditing: false,
	isCreating: false,
};

export function skillFormForEdit(skill: Skill): Partial<SkillFormState> {
	return rustProject("skillEdit", skill);
}
export function skillFormForDuplicate(skill: Skill): SkillFormState {
	return rustProject("skillDuplicate", skill);
}
export function initializeSkillDialog(
	target: SkillsTarget,
	skills: Skill[],
): { selectedId: string | null; form: Partial<SkillFormState> } {
	return rustProject("skillDialog", { target, skills });
}
export function isSkillFormDirty(
	form: SkillFormState,
	original: Skill | null,
): boolean {
	return rustProject("skillDirty", { form, original });
}
export async function saveSkillForm(
	form: SkillFormState,
	selected: Skill | null,
	inlineEdit: boolean,
) {
	const data = {
		name: form.name,
		command: form.command,
		description: form.description,
		promptTemplate: form.promptTemplate,
	};
	if (inlineEdit && selected) {
		await saveSkill(data, selected._id);
		return { selectedId: selected._id, form: { isEditing: false } };
	}
	if (form.isCreating) {
		const created = await saveSkill(data);
		return { selectedId: created._id, form: INITIAL_SKILL_FORM };
	}
	return { selectedId: selected?._id ?? null, form: {} };
}

const skillsKey = ["skills"] as const;
export const emptySkills: Skill[] = [];
export const skillsQuery = (filter = "all", search = "") => ({
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
	const skill = (await response.json()) as Skill;
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
