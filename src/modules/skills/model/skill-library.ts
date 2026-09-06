import { dispatchWindowEvent } from "../../../shared/lib/data.ts";
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
