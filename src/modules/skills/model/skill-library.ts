export type AgentContextMode = "inherit" | "replace";
export interface AgentContextLayer {
	instructions: string;
	mode: AgentContextMode;
	updatedAt: number;
}
export interface EffectiveAgentContext {
	global: AgentContextLayer;
	project: AgentContextLayer | null;
	chat: AgentContextLayer | null;
	effectiveInstructions: string;
	scope: "global" | "project" | "chat";
	skillCount: number;
	skillManifest: string;
	activatedSkills: Array<{
		name: string;
		command: string;
		instructions: string;
	}>;
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
	window.dispatchEvent(
		new CustomEvent<OpenSettingsModalDetail>(OPEN_SETTINGS_MODAL_EVENT, {
			detail: {
				section,
			},
		}),
	);
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
	window.dispatchEvent(
		new CustomEvent(OPEN_SKILLS_EVENT, {
			detail: target,
		}),
	);
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
	category?: string;
	tags: string[];
	isBuiltIn: boolean;
	executionCount: number;
	lastUsed?: number;
	createdAt: number;
	updatedAt: number;
}
export const SKILL_CATEGORIES = [
	"code",
	"refactoring",
	"security",
	"performance",
	"planning",
	"testing",
	"debugging",
	"documentation",
	"git",
	"learning",
	"conversation",
	"custom",
].map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }));
export interface SkillFormState {
	name: string;
	command: string;
	description: string;
	promptTemplate: string;
	category: string;
	tags: string;
	error: string;
	isSaving: boolean;
	isEditing: boolean;
	isCreating: boolean;
}
export type SkillFormAction =
	| { type: "reset" }
	| { type: "setField"; field: string; value: string }
	| { type: "setError"; error: string }
	| { type: "startSaving" }
	| { type: "stopSaving" }
	| { type: "startEdit"; skill: Skill }
	| { type: "startCreate" }
	| { type: "cancelEdit" }
	| { type: "finishEdit" }
	| { type: "finishCreate" };
export const INITIAL_SKILL_FORM: SkillFormState = {
	name: "",
	command: "",
	description: "",
	promptTemplate: "",
	category: "custom",
	tags: "",
	error: "",
	isSaving: false,
	isEditing: false,
	isCreating: false,
};
export function skillFormReducer(
	state: SkillFormState,
	action: SkillFormAction,
): SkillFormState {
	switch (action.type) {
		case "reset":
		case "cancelEdit":
		case "finishCreate":
			return INITIAL_SKILL_FORM;
		case "setField":
			return {
				...state,
				[action.field]: action.value,
			};
		case "setError":
			return {
				...state,
				error: action.error,
			};
		case "startSaving":
			return {
				...state,
				isSaving: true,
				error: "",
			};
		case "stopSaving":
			return {
				...state,
				isSaving: false,
			};
		case "startEdit":
			return {
				...state,
				isEditing: true,
				name: action.skill.name,
				command: action.skill.command,
				description: action.skill.description,
				promptTemplate: action.skill.promptTemplate,
				category: action.skill.category || "custom",
				tags: action.skill.tags.join(", "),
				error: "",
			};
		case "startCreate":
			return {
				...INITIAL_SKILL_FORM,
				isCreating: true,
			};
		case "finishEdit":
			return {
				...state,
				isEditing: false,
			};
	}
}
interface FilterableSkill {
	name: string;
	command: string;
	description: string;
	category?: string;
	isBuiltIn?: boolean;
}
export function filterSkills<T extends FilterableSkill>(
	skills: readonly T[],
	filter: string,
	search: string,
): T[] {
	const q = search.toLowerCase();
	const filtered: T[] = [];
	for (const skill of skills) {
		if (filter !== "all") {
			if (filter === "builtin" && !skill.isBuiltIn) continue;
			if (filter === "custom" && skill.isBuiltIn) continue;
			if (
				filter !== "builtin" &&
				filter !== "custom" &&
				skill.category !== filter
			)
				continue;
		}
		if (
			q &&
			!skill.name.toLowerCase().includes(q) &&
			!skill.command.toLowerCase().includes(q) &&
			!skill.description.toLowerCase().includes(q)
		)
			continue;
		filtered.push(skill);
	}
	return filtered;
}
