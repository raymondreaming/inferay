export const OPEN_SKILLS_EVENT = "inferay-open-skills";

export type SkillsTarget =
	| { mode: "browse" }
	| { mode: "create" }
	| { mode: "edit"; skillId: string };

export function openSkills(target: SkillsTarget = { mode: "browse" }): void {
	window.dispatchEvent(new CustomEvent(OPEN_SKILLS_EVENT, { detail: target }));
}
