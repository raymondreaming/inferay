import { JSDOM } from "jsdom";
import { createRoot } from "octane";
import { expect, test, vi } from "vitest";
import { SkillProposalCard } from "../src/modules/skills/components/SkillProposalCard.tsx";
import { useSkills } from "../src/modules/skills/hooks/useSkills.tsx";
import type { SkillProposal } from "../src/modules/skills/model/skill-proposal.ts";
import { queryClient } from "../src/shared/lib/query-client.ts";

test("does not write a skill until approval, updates other consumers, and preserves the result on remount", async () => {
	queryClient.clear();
	const dom = new JSDOM('<div id="root"></div>', {
		url: "http://localhost/agent",
		pretendToBeVisual: true,
	});
	for (const name of [
		"window",
		"document",
		"localStorage",
		"HTMLElement",
		"Element",
		"Node",
		"CustomEvent",
	] as const)
		Object.defineProperty(globalThis, name, {
			configurable: true,
			value: name === "window" ? dom.window : dom.window[name],
		});
	const proposal: SkillProposal = {
		type: "inferay.skill-proposal",
		action: "create",
		name: "Review",
		command: "review-code",
		description: "Review changes",
		promptTemplate: "Inspect the diff.",
		reason: "Keep this workflow.",
	};
	const writes = vi.fn();
	const result = vi.fn();
	let finishStaleRead: ((response: Response) => void) | undefined;
	let deferRead = false;
	globalThis.fetch = vi.fn(async (_url, options) => {
		if (options?.method === "POST") {
			writes();
			return Response.json({
				...proposal,
				_id: "new-skill",
				isBuiltIn: false,
				tags: [],
				updatedAt: 1,
				createdAt: 1,
				executionCount: 0,
			});
		}
		return deferRead
			? new Promise<Response>((resolve) => {
					finishStaleRead = resolve;
				})
			: Response.json([]);
	}) as typeof fetch;
	function Consumer() {
		const { skills } = useSkills(true);
		return <span data-skills-count>{skills.length}</span>;
	}
	const element = dom.window.document.getElementById("root")!;
	let root = createRoot(element);
	try {
		root.render(
			<>
				<Consumer />
				<SkillProposalCard
					proposal={proposal}
					messageId="approval-test"
					onResult={result}
				/>
			</>,
		);
		await vi.waitFor(() =>
			expect(element.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
				false,
			),
		);
		expect(writes).not.toHaveBeenCalled();
		deferRead = true;
		const staleRead = queryClient.refetchQueries({ queryKey: ["skills"] });
		await vi.waitFor(() => expect(finishStaleRead).toBeDefined());
		const button = element.querySelector<HTMLButtonElement>("button")!;
		button.click();
		button.click();
		await vi.waitFor(() =>
			expect(element.textContent).toContain("Skill saved"),
		);
		expect(writes).toHaveBeenCalledTimes(1);
		expect(result).toHaveBeenCalledTimes(1);
		finishStaleRead!(Response.json([]));
		await staleRead;
		expect(element.querySelector("[data-skills-count]")?.textContent).toBe("1");
		root.unmount();
		root = createRoot(element);
		root.render(
			<SkillProposalCard
				proposal={proposal}
				messageId="approval-test"
				onResult={result}
			/>,
		);
		await vi.waitFor(() =>
			expect(element.textContent).toContain("Skill saved"),
		);
		expect(element.textContent).not.toContain("Approve & save");
		expect(writes).toHaveBeenCalledTimes(1);
		root.unmount();
		root = createRoot(element);
		root.render(
			<SkillProposalCard
				proposal={proposal}
				messageId="decline-test"
				onResult={result}
			/>,
		);
		await vi.waitFor(() => expect(element.textContent).toContain("Decline"));
		Array.from(element.querySelectorAll("button"))
			.find((button) => button.textContent?.trim() === "Decline")!
			.click();
		await vi.waitFor(() =>
			expect(element.textContent).toContain("No changes were made."),
		);
		expect(writes).toHaveBeenCalledTimes(1);
	} finally {
		root.unmount();
		queryClient.clear();
		dom.window.close();
	}
});
