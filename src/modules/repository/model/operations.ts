import type { GitActionResponse } from "@contracts";

export type GitRefOperationRequest = {
	operation: GitActionResponse["operation"];
	action: "start" | "continue" | "skip" | "abort";
	source?: string;
	target?: string;
};
