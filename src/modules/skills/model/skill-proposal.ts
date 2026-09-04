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

export function parseSkillRead(value: string): SkillRead | null {
	try {
		const message = JSON.parse(value);
		if (message?.type !== "inferay.skill-read") return null;
		const skill = message.skill;
		if (!skill || typeof skill.isBuiltIn !== "boolean") return null;
		for (const field of [
			"_id",
			"name",
			"command",
			"description",
			"promptTemplate",
		]) {
			if (typeof skill[field] !== "string") return null;
		}
		return skill;
	} catch {
		return null;
	}
}

export function parseSkillProposal(value: string): SkillProposal | null {
	try {
		const p = JSON.parse(value);
		if (
			p?.type !== "inferay.skill-proposal" ||
			!["create", "update"].includes(p.action)
		)
			return null;
		for (const key of [
			"name",
			"command",
			"description",
			"promptTemplate",
			"reason",
		]) {
			if (typeof p[key] !== "string" || !p[key].trim() || p[key].length > 50000)
				return null;
		}
		if (!/^[a-z][a-z0-9-]*$/.test(p.command)) return null;
		if (
			p.action === "update" &&
			(typeof p.skillId !== "string" ||
				!p.skillId ||
				!Number.isSafeInteger(p.expectedUpdatedAt) ||
				p.expectedUpdatedAt < 0)
		)
			return null;
		return {
			type: p.type,
			action: p.action,
			name: p.name,
			command: p.command,
			description: p.description,
			promptTemplate: p.promptTemplate,
			reason: p.reason,
			...(p.action === "update"
				? { skillId: p.skillId, expectedUpdatedAt: p.expectedUpdatedAt }
				: {}),
		};
	} catch {
		return null;
	}
}

export type SkillMessagePart =
	| { text: string }
	| { proposal: SkillProposal; index: number }
	| { pending: true };

/** Only assistant output is passed here. Code is data; parsing never writes a skill. */
export function splitSkillProposals(
	content: string,
	streaming = false,
): SkillMessagePart[] {
	const parts: SkillMessagePart[] = [];
	const pattern = /^```inferay-skill\s*\n([\s\S]*?)^```[ \t]*(?:\n|$)/gm;
	let cursor = 0;
	for (const match of content.matchAll(pattern)) {
		const proposal = parseSkillProposal(match[1]!);
		if (!proposal) continue;
		if (match.index > cursor)
			parts.push({ text: content.slice(cursor, match.index) });
		parts.push({ proposal, index: match.index });
		cursor = match.index + match[0].length;
	}
	const rest = content.slice(cursor);
	const partial = streaming ? rest.search(/^```inferay-skill(?:\s|$)/m) : -1;
	if (partial >= 0) {
		if (partial) parts.push({ text: rest.slice(0, partial) });
		parts.push({ pending: true });
	} else if (rest) parts.push({ text: rest });
	return parts;
}
