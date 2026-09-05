export type Step = "intro" | "github" | "projects" | "complete";

export function getStepPhase(current: Step, target: Step) {
	const order: Step[] = ["intro", "github", "projects", "complete"];
	return current === target
		? "active"
		: order.indexOf(current) < order.indexOf(target)
			? "before"
			: "after";
}
