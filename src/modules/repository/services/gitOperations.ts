import type { GitActionResponse } from "@contracts";
import type { GitRefOperationRequest } from "@repository/model/operations.ts";
import { project } from "@shared/lib/native.tsx";

type GitOperationPort = (
	cwd: string,
	endpoint: string,
	input: object,
) => Promise<GitActionResponse>;
let transport: GitOperationPort | undefined;
export function configureGitOperations(port: GitOperationPort) {
	transport = port;
}

export function createGitOperations(
	cwd: string | undefined,
	refetch: () => Promise<unknown>,
	select: (id: string | null) => void,
	send = transport,
) {
	if (!send)
		throw new Error("Configure Git operations before mounting the workbench");
	async function run(
		endpoint: string,
		operation: string,
		input: object,
		fallback: string,
	): Promise<GitActionResponse> {
		try {
			if (!cwd) throw new Error("No Git repository selected");
			const result = await send!(cwd, endpoint, input);
			await refetch();
			if (result.selection) select(result.selection.commit);
			return result;
		} catch (error) {
			return project("gitActionFailure", {
				operation,
				error: error instanceof Error ? error.message : fallback,
				errorKind: cwd ? "commandFailed" : "invalidInput",
			});
		}
	}
	return {
		runGraphRefOperation: (input: GitRefOperationRequest) =>
			run("ref-operation", input.operation, input, "Git operation failed"),
		runGraphActionRequest: (input: {
			action: string;
			target?: string;
			targets?: string[];
			name?: string;
			message?: string;
		}) => run("graph-action", input.action, input, "Git action failed"),
	};
}
