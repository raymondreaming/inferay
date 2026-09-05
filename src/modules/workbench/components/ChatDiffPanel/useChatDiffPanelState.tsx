import { useCallback, useEffect, useState } from "octane";
import { postJson } from "../../../../adapters/backend/http.ts";
import type { useGitDiff } from "../../../repository/hooks/useGitDiff.tsx";
import type { useGitGraph } from "../../../repository/hooks/useGitGraph.tsx";
import type { GitInteractiveRebaseStep } from "../../../repository/model/types.ts";
import type { SelectedFile } from "../../changes/components/ChangesPanel/index.tsx";
import type { DiffViewMode } from "../../diff/components/DiffViewer/index.tsx";
import type {
	GitGraphActionRequest,
	GraphSelectionIntent,
} from "../../graph/components/CommitGraph/index.tsx";
import type {
	DragProps,
	GitGraphActionResult,
	GitOperationActivityPhase,
	GitRefOperationPreflight,
	GitRefOperationResult,
} from "./operation-model.ts";
import {
	gitOperationErrorLabel,
	graphActionPresentation,
} from "./operation-model.ts";

export function useChatDiffPanelState(props: {
	readonly diff: ReturnType<typeof useGitDiff>["diff"];
	readonly file: SelectedFile | null;
	readonly loading: boolean;
	readonly mainViewMode: "diff" | "graph";
	readonly onMainViewModeChange: (mode: "diff" | "graph") => void;
	readonly graph: ReturnType<typeof useGitGraph>;
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
	readonly onRunRefOperation: (request: {
		operation:
			| "merge"
			| "rebase"
			| "interactiveRebase"
			| "fastForward"
			| "cherryPick"
			| "revert";
		action: "start" | "continue" | "skip" | "abort";
		source?: string;
		target?: string;
		steps?: GitInteractiveRebaseStep[];
	}) => Promise<GitRefOperationResult>;
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
	const [refOperationPreflight, setRefOperationPreflight] =
		useState<GitRefOperationPreflight | null>(null);
	const [refPreflightRunning, setRefPreflightRunning] = useState(false);
	const [interactiveRebaseOpen, setInteractiveRebaseOpen] = useState(false);
	const [interactiveRebasePlan, setInteractiveRebasePlan] = useState<
		GitInteractiveRebaseStep[]
	>([]);
	const moveRebaseRow = (from: number, to: number) => {
		setInteractiveRebasePlan((current) => {
			if (
				!Number.isInteger(from) ||
				!current[from] ||
				to < 0 ||
				to >= current.length
			)
				return current;
			const next = [...current];
			next.splice(to, 0, next.splice(from, 1)[0]!);
			return next;
		});
	};
	const [pendingGraphAction, setPendingGraphAction] =
		useState<GitGraphActionRequest | null>(null);
	const [graphActionName, setGraphActionName] = useState("");
	const [graphActionMessage, setGraphActionMessage] = useState("");
	const [graphActionResult, setGraphActionResult] =
		useState<GitGraphActionResult | null>(null);
	const [graphActionRunning, setGraphActionRunning] = useState(false);
	useEffect(() => {
		if (!pendingRefAction || !repositoryKey) {
			setRefOperationPreflight(null);
			setRefPreflightRunning(false);
			setInteractiveRebaseOpen(false);
			setInteractiveRebasePlan([]);
			return;
		}
		let current = true;
		setRefOperationPreflight(null);
		setRefPreflightRunning(true);
		void postJson<GitRefOperationPreflight>(
			"/api/git/ref-operation-preflight",
			{
				cwd: repositoryKey,
				source: pendingRefAction.source,
				target: pendingRefAction.target,
			},
		)
			.then((result) => {
				if (!current) return;
				setRefOperationPreflight(result);
				setInteractiveRebasePlan(result.interactiveRebasePlan);
			})
			.catch((error) => {
				if (!current) return;
				setRefOperationResult({
					ok: false,
					operation: "merge",
					outcome: "failed",
					conflicts: [],
					errorKind: "commandFailed",
					error:
						error instanceof Error
							? error.message
							: "Unable to check branch operations",
				});
			})
			.finally(() => {
				if (current) setRefPreflightRunning(false);
			});
		return () => {
			current = false;
		};
	}, [pendingRefAction, repositoryKey]);
	const runRefOperation = useCallback(
		async (
			operation:
				| "merge"
				| "rebase"
				| "interactiveRebase"
				| "fastForward"
				| "cherryPick"
				| "revert",
			action: "start" | "continue" | "skip" | "abort" = "start",
		) => {
			if (action === "start" && !pendingRefAction) return;
			setRefOperationRunning(true);
			const result = await onRunRefOperation({
				operation,
				action,
				source: pendingRefAction?.source,
				target: pendingRefAction?.target,
				steps:
					operation === "interactiveRebase" ? interactiveRebasePlan : undefined,
			});
			setRefOperationResult(result);
			setRefOperationRunning(false);
			if (result.ok) {
				setPendingRefAction(null);
			} else if (result.outcome === "conflicted") {
				setInteractiveRebaseOpen(false);
			}
		},
		[interactiveRebasePlan, onRunRefOperation, pendingRefAction],
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
		? graphActionPresentation(pendingGraphAction.action)
		: null;
	const interactiveRebaseCommits = new Map(
		(refOperationPreflight?.interactiveRebaseCommits ?? []).map((commit) => [
			commit.hash,
			commit,
		]),
	);
	const resumableOperation =
		repositoryOperation.kind === "idle" ? null : repositoryOperation.kind;
	const operationActivity: {
		phase: GitOperationActivityPhase;
		message: string;
	} =
		refOperationRunning || graphActionRunning || refPreflightRunning
			? { phase: "running", message: "Git operation running" }
			: repositoryOperation.phase === "conflicted"
				? { phase: "conflicted", message: "Git operation has conflicts" }
				: repositoryOperation.phase === "awaitingContinuation"
					? {
							phase: "awaitingContinuation",
							message: "Git operation is ready to continue",
						}
					: graphActionResult
						? {
								phase: graphActionResult.ok ? "completed" : "failed",
								message: graphActionResult.ok
									? `Git ${graphActionResult.operation} completed`
									: gitOperationErrorLabel(graphActionResult.errorKind),
							}
						: refOperationResult
							? {
									phase: refOperationResult.ok ? "completed" : "failed",
									message: refOperationResult.ok
										? `Git ${refOperationResult.operation} completed`
										: gitOperationErrorLabel(refOperationResult.errorKind),
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
		refOperationPreflight,
		refPreflightRunning,
		interactiveRebaseOpen,
		setInteractiveRebaseOpen,
		interactiveRebasePlan,
		setInteractiveRebasePlan,
		moveRebaseRow,
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
		interactiveRebaseCommits,
		resumableOperation,
		operationActivity,
	};
}
export type {
	DragProps,
	GitGraphActionResult,
	GitOperationActivityPhase,
	GitOperationErrorKind,
	GitOperationOutcome,
	GitRefOperationPreflight,
	GitRefOperationResult,
	GraphActionPresentation,
} from "./operation-model.ts";
export {
	gitOperationErrorLabel,
	graphActionPresentation,
} from "./operation-model.ts";
