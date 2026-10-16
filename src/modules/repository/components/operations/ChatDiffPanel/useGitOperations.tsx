import type { GitActionResponse, GitRefOperationRequest } from "@contracts";
import type { GitGraphActionRequest } from "@repository/components/graph/components/CommitGraph/index.tsx";
import type { useGitGraph } from "@repository/hooks/useGitGraph.tsx";
import { preflightGitRefOperation } from "@repository/services/gitApi.ts";
import { useBackgroundQuery as useQuery } from "@shared/hooks/useQueryResource.tsx";
import { project } from "@shared/lib/native.tsx";
import { type Accessor, createMemo, createStore } from "solid-js";

export function useGitOperations(
	props: Accessor<{
		readonly repositoryKey?: string;
		readonly graph: ReturnType<typeof useGitGraph>;
		readonly onRunRefOperation: (
			request: GitRefOperationRequest,
		) => Promise<GitActionResponse>;
		readonly onRunGraphAction: (
			request: GitGraphActionRequest & {
				name?: string;
				message?: string;
			},
		) => Promise<GitActionResponse>;
	}>,
) {
	const [state, setState] = createStore(
		{
			pendingRefAction: null as { source: string; target: string } | null,
			refOperationResult: null as GitActionResponse | null,
			refOperationRunning: false,
			pendingGraphAction: null as GitGraphActionRequest | null,
			graphActionName: "",
			graphActionMessage: "",
			graphActionResult: null as GitActionResponse | null,
			graphActionRunning: false,
		},
		{ shallow: true },
	);
	const update = (patch: Partial<typeof state>) =>
		setState((draft) => {
			Object.assign(draft, patch);
		});
	const preflight = useQuery(() => {
		const repositoryKey = props().repositoryKey,
			pending = state.pendingRefAction;
		return {
			queryKey: ["git-ref-preflight", repositoryKey, pending],
			queryFn: ({ signal }) =>
				preflightGitRefOperation(
					{
						cwd: repositoryKey ?? "",
						source: pending?.source ?? "",
						target: pending?.target ?? "",
					},
					signal,
				),
			enabled: !!pending && !!repositoryKey,
			gcTime: 0,
			staleTime: 0,
			retry: false,
			refetchOnReconnect: false,
		};
	});
	const runRefOperation = async (
		operation: GitRefOperationRequest["operation"],
		action: GitRefOperationRequest["action"] = "start",
	) => {
		const pending = state.pendingRefAction;
		if (action === "start" && !pending) return;
		update({ refOperationRunning: true });
		const result = await props().onRunRefOperation({
			operation,
			action,
			source: pending?.source,
			target: pending?.target,
		});
		update({ refOperationResult: result, refOperationRunning: false });
		if (result.ok) {
			update({ pendingRefAction: null });
		}
	};
	let graphActionInFlight = false;
	const executeGraphAction = async (
		request: GitGraphActionRequest,
		name?: string,
		message?: string,
	) => {
		if (graphActionInFlight) return;
		graphActionInFlight = true;
		update({ graphActionRunning: true, graphActionResult: null });
		try {
			const result = await props().onRunGraphAction({
				...request,
				name,
				message,
			});
			update({ graphActionResult: result });
			if (result.ok) update({ pendingGraphAction: null });
		} catch (error) {
			update({
				graphActionResult: project<GitActionResponse>("gitActionFailure", {
					operation: request.action,
					error: error instanceof Error ? error.message : String(error),
					errorKind: "commandFailed",
				}),
			});
		} finally {
			graphActionInFlight = false;
			update({ graphActionRunning: false });
		}
	};
	const runGraphAction = async () => {
		const request = state.pendingGraphAction;
		if (request)
			await executeGraphAction(
				request,
				state.graphActionName.trim() || undefined,
				state.graphActionMessage.trim() || undefined,
			);
	};
	const requestGraphAction = (request: GitGraphActionRequest) => {
		if (graphActionInFlight) return;
		update({
			graphActionName: request.suggestedName ?? "",
			graphActionMessage: "",
			graphActionResult: null,
			pendingGraphAction: request,
		});
		if (props().graph.actions[request.action]?.needsConfirm === false)
			void executeGraphAction(request);
	};
	const presentation = createMemo(() => {
		const pending = state.pendingGraphAction;
		return pending ? (props().graph.actions[pending.action] ?? null) : null;
	});
	const dialogOpen = createMemo(() => {
		const action = presentation();
		return (
			!!action && (action.needsConfirm || !!state.graphActionResult?.error)
		);
	});
	const operationModel = createMemo(() =>
		project<{
			actions: GitOperationAction[];
			conflictMessage: string | null;
			blockedReason: string | null;
			operationActivity: {
				phase: GitOperationActivityPhase;
				message: string;
			};
			recoveryActions: GitOperationAction[];
			recoveryTitle: string | null;
			recoveryMessage: string;
		}>("gitOperationModel", {
			repository: props().graph.operation,
			result: state.refOperationResult,
			graphResult: state.graphActionResult,
			preflight: preflight.data,
			preflightFailed: !!preflight.error,
			running:
				state.refOperationRunning ||
				state.graphActionRunning ||
				preflight.isFetching,
		}),
	);

	return {
		state,
		update,
		preflight,
		presentation,
		dialogOpen,
		operationModel,
		runRefOperation,
		requestGraphAction,
		runGraphAction,
	};
}
type GitOperationActivityPhase =
	| "idle"
	| "running"
	| "conflicted"
	| "awaitingContinuation"
	| "completed"
	| "failed";
type GitOperationAction = {
	label: string;
	operation: GitRefOperationRequest["operation"] | null;
	phase: GitRefOperationRequest["action"];
	primary: boolean;
	disabled?: boolean;
};
