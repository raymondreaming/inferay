import type { GitActionResponse } from "@contracts";
import type { SelectedFile } from "@repository/components/changes/components/ChangesPanel/index.tsx";
import type { DiffViewMode } from "@repository/components/diff/components/DiffViewer/index.tsx";
import type {
	GitGraphActionRequest,
	GraphSelectionIntent,
} from "@repository/components/graph/components/CommitGraph/index.tsx";
import type { GraphPreferences } from "@repository/components/graph/components/CommitGraph/useCommitGraphState.tsx";
import type { useGitDiff } from "@repository/hooks/useGitDiff.tsx";
import type { useGitGraph } from "@repository/hooks/useGitGraph.tsx";
import type { GitRefOperationRequest } from "@repository/model/operations.ts";
import { preflightGitRefOperation } from "@repository/services/gitApi.ts";
import { useBackgroundQuery as useQuery } from "@shared/hooks/useQueryResource.tsx";
import { queryClient } from "@shared/lib/dom.tsx";
import { project } from "@shared/lib/native.tsx";
import type { DragProps } from "@workspace/components/WorkspaceCanvas/index.tsx";
import { type Accessor, createMemo, createSignal, merge } from "solid-js";
export function useChatDiffPanelState(
	_props: Accessor<{
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
		) => Promise<GitActionResponse>;
		readonly onRunGraphAction: (
			request: GitGraphActionRequest & {
				name?: string;
				message?: string;
			},
		) => Promise<GitActionResponse>;
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
	}>,
) {
	const stats = createMemo(
		() =>
			_props().diff?.metadata?.stats ?? {
				added: 0,
				removed: 0,
				hunks: 0,
				lines: 0,
			},
	);
	const [hoveredModeIndex, setHoveredModeIndex] = createSignal<number | null>(
		null,
	);
	const [pendingRefAction, setPendingRefAction] = createSignal<{
		source: string;
		target: string;
	} | null>(null);
	const [refOperationResult, setRefOperationResult] =
		createSignal<GitActionResponse | null>(null);
	const [refOperationRunning, setRefOperationRunning] = createSignal(false);
	const [pendingGraphAction, setPendingGraphAction] =
		createSignal<GitGraphActionRequest | null>(null);
	const [graphActionName, setGraphActionName] = createSignal("");
	const [graphActionMessage, setGraphActionMessage] = createSignal("");
	const [graphActionResult, setGraphActionResult] =
		createSignal<GitActionResponse | null>(null);
	const [graphActionRunning, setGraphActionRunning] = createSignal(false);
	const preflight = useQuery(
		() => {
			const repositoryKey = _props().repositoryKey,
				_pendingRefActionValue = pendingRefAction();
			return {
				queryKey: ["git-ref-preflight", repositoryKey, _pendingRefActionValue],
				queryFn: ({ signal }) =>
					preflightGitRefOperation(
						{
							cwd: repositoryKey ?? "",
							source: _pendingRefActionValue?.source ?? "",
							target: _pendingRefActionValue?.target ?? "",
						},
						signal,
					),
				enabled: !!_pendingRefActionValue && !!repositoryKey,
				gcTime: 0,
				staleTime: 0,
				retry: false,
				refetchOnReconnect: false,
			};
		},
		() => queryClient,
	);
	const runRefOperation = async (
		operation: GitRefOperationRequest["operation"],
		action: GitRefOperationRequest["action"] = "start",
	) => {
		const _pendingRefActionValue2 = pendingRefAction();
		if (action === "start" && !_pendingRefActionValue2) return;
		setRefOperationRunning(true);
		const result = await _props().onRunRefOperation({
			operation,
			action,
			source: _pendingRefActionValue2?.source,
			target: _pendingRefActionValue2?.target,
		});
		setRefOperationResult(result);
		setRefOperationRunning(false);
		if (result.ok) {
			setPendingRefAction(null);
		}
	};
	const requestGraphAction = (request: GitGraphActionRequest) => {
		setGraphActionName(request.suggestedName ?? "");
		setGraphActionMessage("");
		setGraphActionResult(null);
		setPendingGraphAction(request);
	};
	const runGraphAction = async () => {
		const _pendingGraphActionValue = pendingGraphAction();
		if (!_pendingGraphActionValue) return;
		setGraphActionRunning(true);
		const result = await _props().onRunGraphAction({
			..._pendingGraphActionValue,
			name: graphActionName().trim() || undefined,
			message: graphActionMessage().trim() || undefined,
		});
		setGraphActionRunning(false);
		setGraphActionResult(result);
		if (result.ok) setPendingGraphAction(null);
	};
	const activeModeIndex = createMemo(() => {
		const _sourceValue2 = _props();
		return _sourceValue2.mainViewMode === "graph"
			? -1
			: _sourceValue2.viewMode === "split"
				? 0
				: 1;
	});
	const pendingGraphActionPresentation = createMemo(() => {
		const _pendingGraphActionValue2 = pendingGraphAction();
		return _pendingGraphActionValue2
			? (_props().graph.actions[_pendingGraphActionValue2.action] ?? null)
			: null;
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
			repository: _props().graph.operation,
			result: refOperationResult(),
			graphResult: graphActionResult(),
			preflight: preflight.data,
			preflightFailed: !!preflight.error,
			running:
				refOperationRunning() || graphActionRunning() || preflight.isFetching,
		}),
	);
	return merge(_props, {
		get stats() {
			return stats();
		},
		get hoveredModeIndex() {
			return hoveredModeIndex();
		},
		setHoveredModeIndex,
		get pendingRefAction() {
			return pendingRefAction();
		},
		setPendingRefAction,
		get refOperationResult() {
			return refOperationResult();
		},
		setRefOperationResult,
		get refOperationRunning() {
			return refOperationRunning();
		},
		get refPreflightRunning() {
			return preflight.isFetching;
		},
		get refPreflightError() {
			return preflight.error
				? preflight.error.message || "Unable to check branch operations"
				: null;
		},
		get pendingGraphAction() {
			return pendingGraphAction();
		},
		setPendingGraphAction,
		get graphActionName() {
			return graphActionName();
		},
		setGraphActionName,
		get graphActionMessage() {
			return graphActionMessage();
		},
		setGraphActionMessage,
		get graphActionResult() {
			return graphActionResult();
		},
		get graphActionRunning() {
			return graphActionRunning();
		},
		runRefOperation,
		requestGraphAction,
		runGraphAction,
		get activeModeIndex() {
			return activeModeIndex();
		},
		get operationModel() {
			const _operationModelValue = operationModel();
			return _operationModelValue;
		},
		get pendingGraphActionPresentation() {
			return pendingGraphActionPresentation();
		},
		get operationActivity() {
			const _operationModelValue = operationModel();
			return _operationModelValue.operationActivity;
		},
	});
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
