export type GoalSystemStatus =
	| "active"
	| "paused"
	| "complete"
	| "cleared"
	| "empty";

export type GoalSystemMessage = {
	type: "inferay.goal";
	status: GoalSystemStatus;
	objective?: string;
	turns?: number;
	detail?: string;
};

export function serializeGoalSystemMessage(message: GoalSystemMessage): string {
	return JSON.stringify(message);
}

export function parseGoalSystemMessage(
	content: string,
): GoalSystemMessage | null {
	if (!content.trim().startsWith("{")) return null;
	try {
		const parsed = JSON.parse(content) as Partial<GoalSystemMessage>;
		if (
			parsed?.type !== "inferay.goal" ||
			!["active", "paused", "complete", "cleared", "empty"].includes(
				String(parsed.status),
			)
		) {
			return null;
		}
		return {
			type: "inferay.goal",
			status: parsed.status as GoalSystemStatus,
			objective:
				typeof parsed.objective === "string" ? parsed.objective : undefined,
			turns: typeof parsed.turns === "number" ? parsed.turns : undefined,
			detail: typeof parsed.detail === "string" ? parsed.detail : undefined,
		};
	} catch {
		return null;
	}
}
