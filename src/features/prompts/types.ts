export interface Prompt {
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

export const PROMPT_CATEGORIES = [
	{ value: "code", label: "Code" },
	{ value: "refactoring", label: "Refactoring" },
	{ value: "security", label: "Security" },
	{ value: "performance", label: "Performance" },
	{ value: "planning", label: "Planning" },
	{ value: "testing", label: "Testing" },
	{ value: "debugging", label: "Debugging" },
	{ value: "documentation", label: "Documentation" },
	{ value: "git", label: "Git" },
	{ value: "learning", label: "Learning" },
	{ value: "conversation", label: "Conversation" },
	{ value: "custom", label: "Custom" },
] as const;
