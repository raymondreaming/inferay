import { useQuery } from "@octanejs/tanstack-query";
import { useCallback, useState } from "octane";
import { postJson } from "../../../../adapters/backend/http.ts";
import { queryClient } from "../../../../shared/lib/data.ts";
import type { useGitDiff } from "../../../repository/hooks/useGitDiff.tsx";
import type { useGitGraph } from "../../../repository/hooks/useGitGraph.tsx";
import type { SelectedFile } from "../../changes/components/ChangesPanel/index.tsx";
import type { DiffViewMode } from "../../diff/components/DiffViewer/index.tsx";
import type {
	GitGraphActionRequest,
	GraphSelectionIntent,
} from "../../graph/components/CommitGraph/index.tsx";
import type { GraphPreferences } from "../../graph/model/graph-model.ts";
import type {
	DragProps,
	GitGraphActionResult,
	GitOperationActivityPhase,
	GitRefOperationPreflight,
	GitRefOperationRequest,
	GitRefOperationResult,
} from "../../model/workbench-model.ts";

export function useChatDiffPanelState(props: {
	readonly diff: ReturnType<typeof useGitDiff>["diff"];
	readonly file: SelectedFile | null;
	readonly loading: boolean;
	readonly error?: string;
	readonly mainViewMode: "diff" | "graph";
	readonly onMainViewModeChange: (mode: "diff" | "graph") => void;
	readonly graph: ReturnType<typeof useGitGraph>;
	readonly graphPreferences: GraphPreferences;
	readonly onGraphPreferencesChange: (
		update:
			| GraphPreferences
			| ((current: GraphPreferences) => GraphPreferences),
	) => void;
	readonly graphLoading: boolean;
	readonly graphError: string | null;
	readonly selectionAnnouncement: string;
	readonly repositoryKey?: string;
	readonly selectedCommitHash: string | null;
	readonly selectedCommitIds: readonly string[];
	readonly onSelectCommit: (
		itemId: string,
		intent?: GraphSelectionIntent,
	) => void;
	readonly onOpenGraphSelection: (itemId: string) => void;
	readonly onCheckoutRef: (ref: string) => void;
	readonly onRunRefOperation: (
		request: GitRefOperationRequest,
	) => Promise<GitRefOperationResult>;
	readonly onRunGraphAction: (
		request: GitGraphActionRequest & { name?: string; message?: string },
	) => Promise<GitGraphActionResult>;
	readonly onLoadMoreCommits: () => void;
	readonly branch?: string;
	readonly onClose: () => void;
	readonly closeLabel: string;
	readonly viewMode: DiffViewMode;
	readonly onViewModeChange: (mode: DiffViewMode) => void;
	readonly startAtFirstChange: boolean;
	readonly zenMode: boolean;
	readonly onToggleZenMode: () => void;
	readonly drag?: DragProps;
}) {
	const {
		diff,
		mainViewMode,
		graph,
		repositoryKey,
		onRunRefOperation,
		onRunGraphAction,
		viewMode,
		zenMode,
	} = props;

	const stats = diff?.metadata?.stats ?? {
		added: 0,
		removed: 0,
		hunks: 0,
		lines: 0,
	};
	const [hoveredModeIndex, setHoveredModeIndex] = useState<number | null>(null);
	const [pendingRefAction, setPendingRefAction] = useState<{
		source: string;
		target: string;
	} | null>(null);
	const [refOperationResult, setRefOperationResult] =
		useState<GitRefOperationResult | null>(null);
	const [refOperationRunning, setRefOperationRunning] = useState(false);
	const [pendingGraphAction, setPendingGraphAction] =
		useState<GitGraphActionRequest | null>(null);
	const [graphActionName, setGraphActionName] = useState("");
	const [graphActionMessage, setGraphActionMessage] = useState("");
	const [graphActionResult, setGraphActionResult] =
		useState<GitGraphActionResult | null>(null);
	const [graphActionRunning, setGraphActionRunning] = useState(false);
	const preflight = useQuery(
		{
			queryKey: ["git-ref-preflight", repositoryKey, pendingRefAction],
			queryFn: ({ signal }) =>
				postJson<GitRefOperationPreflight>(
					"/api/git/ref-operation-preflight",
					{ cwd: repositoryKey, ...pendingRefAction },
					{ signal },
				),
			enabled: !!pendingRefAction && !!repositoryKey,
			gcTime: 0,
			staleTime: 0,
			retry: false,
			refetchOnReconnect: false,
		},
		queryClient,
	);
	const runRefOperation = useCallback(
		async (
			operation: GitRefOperationRequest["operation"],
			action: GitRefOperationRequest["action"] = "start",
		) => {
			if (action === "start" && !pendingRefAction) return;
			setRefOperationRunning(true);
			const result = await onRunRefOperation({
				operation,
				action,
				source: pendingRefAction?.source,
				target: pendingRefAction?.target,
			});
			setRefOperationResult(result);
			setRefOperationRunning(false);
			if (result.ok) {
				setPendingRefAction(null);
			}
		},
		[onRunRefOperation, pendingRefAction],
	);
	const requestGraphAction = useCallback((request: GitGraphActionRequest) => {
		setGraphActionName(request.suggestedName ?? "");
		setGraphActionMessage("");
		setGraphActionResult(null);
		setPendingGraphAction(request);
	}, []);
	const runGraphAction = useCallback(async () => {
		if (!pendingGraphAction) return;
		setGraphActionRunning(true);
		const result = await onRunGraphAction({
			...pendingGraphAction,
			name: graphActionName.trim() || undefined,
			message: graphActionMessage.trim() || undefined,
		});
		setGraphActionRunning(false);
		setGraphActionResult(result);
		if (result.ok) setPendingGraphAction(null);
	}, [
		graphActionMessage,
		graphActionName,
		onRunGraphAction,
		pendingGraphAction,
	]);
	const activeModeIndex = zenMode
		? 2
		: mainViewMode === "graph"
			? -1
			: viewMode === "split"
				? 0
				: 1;
	const repositoryOperation = graph.operation ?? {
		kind: "idle" as const,
		phase: "idle" as const,
		conflicts: [] as string[],
	};
	const pendingGraphActionPresentation = pendingGraphAction
		? (graph.actions[pendingGraphAction.action] ?? null)
		: null;
	const resumableOperation =
		repositoryOperation.kind === "idle" ? null : repositoryOperation.kind;
	const lastResult =
		graphActionResult ??
		refOperationResult ??
		(preflight.error
			? { ok: false, operation: "merge", errorLabel: "Git command failed" }
			: null);
	const operationActivity: {
		phase: GitOperationActivityPhase;
		message: string;
	} =
		refOperationRunning || graphActionRunning || preflight.isFetching
			? { phase: "running", message: "Git operation running" }
			: repositoryOperation.phase === "conflicted"
				? { phase: "conflicted", message: "Git operation has conflicts" }
				: repositoryOperation.phase === "awaitingContinuation"
					? {
							phase: "awaitingContinuation",
							message: "Git operation is ready to continue",
						}
					: lastResult
						? {
								phase: lastResult.ok ? "completed" : "failed",
								message: lastResult.ok
									? `Git ${lastResult.operation} completed`
									: (lastResult.errorLabel ?? "Git command failed"),
							}
						: { phase: "idle", message: "" };

	return {
		...props,
		stats,
		hoveredModeIndex,
		setHoveredModeIndex,
		pendingRefAction,
		setPendingRefAction,
		refOperationResult,
		setRefOperationResult,
		refOperationRunning,
		refOperationPreflight: preflight.data ?? null,
		refPreflightRunning: preflight.isFetching,
		refPreflightError: preflight.error
			? preflight.error.message || "Unable to check branch operations"
			: null,
		pendingGraphAction,
		setPendingGraphAction,
		graphActionName,
		setGraphActionName,
		graphActionMessage,
		setGraphActionMessage,
		graphActionResult,
		graphActionRunning,
		runRefOperation,
		requestGraphAction,
		runGraphAction,
		activeModeIndex,
		repositoryOperation,
		pendingGraphActionPresentation,
		resumableOperation,
		operationActivity,
	};
}
