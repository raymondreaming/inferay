import type { Prompt } from "./types.ts";

export interface PromptFormState {
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

export type PromptFormAction =
	| { type: "reset" }
	| { type: "setField"; field: string; value: string }
	| { type: "setError"; error: string }
	| { type: "startSaving" }
	| { type: "stopSaving" }
	| { type: "startEdit"; prompt: Prompt }
	| { type: "startCreate" }
	| { type: "cancelEdit" }
	| { type: "finishEdit" }
	| { type: "finishCreate" };

export const INITIAL_PROMPT_FORM: PromptFormState = {
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

export function promptFormReducer(
	state: PromptFormState,
	action: PromptFormAction,
): PromptFormState {
	switch (action.type) {
		case "reset":
		case "cancelEdit":
		case "finishCreate":
			return INITIAL_PROMPT_FORM;
		case "setField":
			return { ...state, [action.field]: action.value };
		case "setError":
			return { ...state, error: action.error };
		case "startSaving":
			return { ...state, isSaving: true, error: "" };
		case "stopSaving":
			return { ...state, isSaving: false };
		case "startEdit":
			return {
				...state,
				isEditing: true,
				name: action.prompt.name,
				command: action.prompt.command,
				description: action.prompt.description,
				promptTemplate: action.prompt.promptTemplate,
				category: action.prompt.category || "custom",
				tags: action.prompt.tags.join(", "),
				error: "",
			};
		case "startCreate":
			return { ...INITIAL_PROMPT_FORM, isCreating: true };
		case "finishEdit":
			return { ...state, isEditing: false };
	}
}
