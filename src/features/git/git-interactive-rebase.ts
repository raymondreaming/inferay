export type GitInteractiveRebaseCommit = {
	readonly hash: string;
	readonly message: string;
	readonly author: string;
	readonly date: string;
};

export type GitInteractiveRebaseStep = {
	readonly hash: string;
	readonly action: "pick" | "reword" | "squash" | "drop";
	readonly message?: string;
};

export function createInteractiveRebasePlan(
	commits: readonly GitInteractiveRebaseCommit[],
): GitInteractiveRebaseStep[] {
	return commits.map((commit) => ({
		hash: commit.hash,
		action: "pick",
		message: commit.message,
	}));
}

export function updateInteractiveRebaseStep(
	plan: readonly GitInteractiveRebaseStep[],
	index: number,
	patch: Partial<Pick<GitInteractiveRebaseStep, "action" | "message">>,
): GitInteractiveRebaseStep[] {
	return plan.map((step, stepIndex) =>
		stepIndex === index ? { ...step, ...patch } : step,
	);
}

export function moveInteractiveRebaseStep(
	plan: readonly GitInteractiveRebaseStep[],
	from: number,
	to: number,
): GitInteractiveRebaseStep[] {
	if (
		from < 0 ||
		to < 0 ||
		from >= plan.length ||
		to >= plan.length ||
		from === to
	) {
		return [...plan];
	}
	const next = [...plan];
	const [step] = next.splice(from, 1);
	if (!step) return [...plan];
	next.splice(to, 0, step);
	return next;
}

export function validateInteractiveRebasePlan(
	plan: readonly GitInteractiveRebaseStep[],
): string | null {
	if (!plan.length) return "There are no commits to rebase";
	let retained = false;
	for (const step of plan) {
		if (step.action === "squash" && !retained) {
			return "The first retained commit cannot be squashed";
		}
		if (step.action === "reword" && !step.message?.trim()) {
			return `Enter a replacement message for ${step.hash.slice(0, 7)}`;
		}
		if (step.action !== "drop" && step.action !== "squash") retained = true;
	}
	return null;
}
