import { expect, test } from "bun:test";
import {
	parseSkillProposal,
	splitSkillProposals,
} from "../src/modules/skills/model/skill-proposal.ts";

const proposal = {
	type: "inferay.skill-proposal",
	action: "create",
	name: "Review",
	command: "review-code",
	description: "Review changes",
	promptTemplate: "Inspect the diff. Report risks.",
	reason: "Keep this review workflow.",
};

test("accepts complete proposals but never malformed edits or incomplete streaming output", () => {
	expect(parseSkillProposal(JSON.stringify(proposal))).toEqual(proposal);
	expect(
		parseSkillProposal(JSON.stringify({ ...proposal, action: "update" })),
	).toBeNull();
	expect(
		parseSkillProposal(JSON.stringify({ ...proposal, action: "delete" })),
	).toBeNull();
	expect(
		parseSkillProposal(JSON.stringify({ ...proposal, command: "../file" })),
	).toBeNull();
	expect(
		parseSkillProposal(JSON.stringify({ ...proposal, promptTemplate: "" })),
	).toBeNull();
	const block = `\`\`\`inferay-skill\n${JSON.stringify(proposal)}\n\`\`\``;
	expect(splitSkillProposals(`Please review.\n${block}`)).toEqual([
		{ text: "Please review.\n" },
		{ proposal, index: 15 },
	]);
	expect(splitSkillProposals(block.slice(0, -3), true)).toEqual([
		{ pending: true },
	]);
});
