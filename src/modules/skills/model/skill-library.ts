import { fetchJson, sendJson } from "../../../adapters/backend/http.ts";
import { dispatchWindowEvent, queryClient } from "../../../shared/lib/data.ts";
export type AgentContextMode = "inherit" | "replace";
interface AgentContextLayer {
	instructions: string;
	mode: AgentContextMode;
	updatedAt: number;
}
export interface EffectiveAgentContext {
	global: AgentContextLayer;
	project: AgentContextLayer | null;
	chat: AgentContextLayer | null;
	effectiveInstructions: string;
}
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
export interface Skill {
	_id: string;
	name: string;
	description: string;
	command: string;
	promptTemplate: string;
	isBuiltIn: boolean;
	createdAt: number;
	updatedAt: number;
}
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
	return {
		isEditing: true,
		name: skill.name,
		command: skill.command,
		description: skill.description,
		promptTemplate: skill.promptTemplate,
		error: "",
	};
}
export function skillFormForDuplicate(skill: Skill): SkillFormState {
	return {
		...INITIAL_SKILL_FORM,
		isCreating: true,
		name: `${skill.name} copy`,
		command: `${skill.command}-custom`,
		description: skill.description,
		promptTemplate: skill.promptTemplate,
	};
}
export function initializeSkillDialog(target: SkillsTarget, skills: Skill[]) {
	if (target.mode === "create")
		return {
			selectedId: null,
			form: { ...INITIAL_SKILL_FORM, isCreating: true },
		};
	if (target.mode === "browse")
		return { selectedId: skills[0]?._id ?? null, form: INITIAL_SKILL_FORM };
	const skill = skills.find((item) => item._id === target.skillId);
	return skill
		? {
				selectedId: skill._id,
				form: skill.isBuiltIn ? INITIAL_SKILL_FORM : skillFormForEdit(skill),
			}
		: {
				selectedId: null,
				form: {
					...INITIAL_SKILL_FORM,
					error: "This skill is no longer available.",
				},
			};
}
export function isSkillFormDirty(form: SkillFormState, original: Skill | null) {
	return (
		(form.isCreating || form.isEditing) &&
		(["name", "command", "description", "promptTemplate"] as const).some(
			(field) => form[field] !== (original?.[field] ?? ""),
		)
	);
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
