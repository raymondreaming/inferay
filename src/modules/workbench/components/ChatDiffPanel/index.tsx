import * as stylex from "@octanejs/stylex";
import type { useGitGraph } from "../../../repository/hooks/useGitGraph.tsx";
import { DiffViewer } from "../../diff/components/DiffViewer/index.tsx";
import { DiffViewerBoundary } from "../../diff/components/DiffViewerBoundary/index.tsx";
import { CommitGraph } from "../../graph/components/CommitGraph/index.tsx";
import { GraphActionDialog } from "./GraphActionDialog.tsx";
import { RefOperationDialog } from "./RefOperationDialog.tsx";
import { RepositoryOperationBar } from "./RepositoryOperationBar.tsx";
import { styles } from "./styles.ts";
import { useChatDiffPanelState } from "./useChatDiffPanelState.tsx";
import { ViewerHeader } from "./ViewerHeader.tsx";

export function gitGraphEmptyLabel(
	graph: ReturnType<typeof useGitGraph>,
): string {
	switch (graph.state) {
		case "unborn":
			return "This branch does not have its first commit yet";
		case "empty":
			return "This repository has no commits";
		case "nonRepository":
			return "The selected folder is not a Git repository";
		case "commandFailed":
			return graph.stateError || "Git history could not be read";
		default:
			return "No commits";
	}
}

export function ChatDiffPanel(
	props: Parameters<typeof useChatDiffPanelState>[0],
) {
	const {
		diff,
		file,
		loading,
		mainViewMode,
		onMainViewModeChange,
		graph,
		graphLoading,
		graphError,
		selectionAnnouncement,
		repositoryKey,
		selectedCommitHash,
		selectedCommitIds,
		onSelectCommit,
		onOpenGraphSelection,
		onCheckoutRef,
		onLoadMoreCommits,
		branch,
		onClose,
		closeLabel,
		viewMode,
		onViewModeChange,
		startAtFirstChange,
		zenMode,
		onToggleZenMode,
		drag,
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
	} = useChatDiffPanelState(props);
	return (
		<section {...stylex.props(styles.viewerPanel)}>
			<span role="status" aria-live="polite" {...stylex.props(styles.srStatus)}>
				{selectionAnnouncement}
			</span>
			<span
				role="status"
				aria-live="polite"
				data-git-operation-phase={operationActivity.phase}
				{...stylex.props(styles.srStatus)}
			>
				{operationActivity.message}
			</span>
			<div
				aria-hidden="true"
				data-floating-viewer-scrim="true"
				{...stylex.props(
					styles.viewerFloatingScrim,
					mainViewMode === "graph" && styles.viewerFloatingScrimAboveContent,
				)}
			/>
			<ViewerHeader
				mainViewMode={mainViewMode}
				drag={drag}
				file={file}
				stats={stats}
				graphActionRunning={graphActionRunning}
				requestGraphAction={requestGraphAction}
				setHoveredModeIndex={setHoveredModeIndex}
				hoveredModeIndex={hoveredModeIndex}
				activeModeIndex={activeModeIndex}
				onMainViewModeChange={onMainViewModeChange}
				onViewModeChange={onViewModeChange}
				viewMode={viewMode}
				onToggleZenMode={onToggleZenMode}
				zenMode={zenMode}
				onClose={onClose}
				closeLabel={closeLabel}
			/>
			<div
				{...stylex.props(
					styles.viewerBody,
					mainViewMode !== "graph" && styles.viewerBodyAboveScrim,
				)}
			>
				{mainViewMode === "graph" ? (
					graphLoading && graph.commits.length === 0 && !graph.searchQuery ? (
						<div {...stylex.props(styles.viewerEmpty)}>Loading history…</div>
					) : graphError && graph.commits.length === 0 && !graph.searchQuery ? (
						<div {...stylex.props(styles.viewerEmpty)}>{graphError}</div>
					) : graph.commits.length === 0 && !graph.searchQuery ? (
						<div {...stylex.props(styles.viewerEmpty)}>
							{gitGraphEmptyLabel(graph)}
						</div>
					) : (
						<CommitGraph
							commits={graph.commits}
							ancestry={graph.ancestry}
							onSearchChange={graph.setSearchQuery}
							searchActive={Boolean(graph.searchQuery)}
							searchQuery={graph.searchQuery}
							emptyLabel={
								graphLoading
									? "Searching history…"
									: (graphError ?? graph.stateError ?? "No matching commits")
							}
							rows={graph.rows}
							worktrees={graph.worktrees}
							selectedHash={selectedCommitHash ?? undefined}
							selectedIds={selectedCommitIds}
							onSelect={onSelectCommit}
							onOpenSelection={onOpenGraphSelection}
							onCheckoutRef={onCheckoutRef}
							branch={branch}
							embedded
							hasMore={graph.hasMore}
							loadingMore={graph.loading}
							repositoryKey={repositoryKey}
							onLoadMore={onLoadMoreCommits}
							onRefDrop={(source, target) => {
								setRefOperationResult(null);
								setInteractiveRebaseOpen(false);
								setPendingRefAction({ source, target });
							}}
							onGraphAction={requestGraphAction}
							onCompareWithWip={(itemId) => {
								const wip = graph.commits.find(
									(item) =>
										item.itemKind === "worktreeWip" && item.id === "wip",
								);
								if (!wip) return;
								onSelectCommit(wip.id);
								onSelectCommit(itemId, { additive: true, range: false });
							}}
						/>
					)
				) : diff && file ? (
					<DiffViewerBoundary resetKey={`${file.path}:${file.staged}`}>
						<DiffViewer
							diff={diff}
							filePath={file.path}
							staged={file.staged}
							loading={false}
							onClose={onClose}
							hideHeader
							hideToolbar
							viewMode={viewMode}
							onViewModeChange={onViewModeChange}
							startAtFirstChange={startAtFirstChange}
						/>
					</DiffViewerBoundary>
				) : !loading ? (
					<div {...stylex.props(styles.viewerEmpty)}>No diff available</div>
				) : null}
				{mainViewMode === "graph" && pendingRefAction ? (
					<RefOperationDialog
						interactiveRebaseOpen={interactiveRebaseOpen}
						pendingRefAction={pendingRefAction}
						refOperationResult={refOperationResult}
						interactiveRebasePlan={interactiveRebasePlan}
						interactiveRebaseCommits={interactiveRebaseCommits}
						moveRebaseRow={moveRebaseRow}
						setInteractiveRebasePlan={setInteractiveRebasePlan}
						refPreflightRunning={refPreflightRunning}
						refOperationPreflight={refOperationPreflight}
						refOperationRunning={refOperationRunning}
						runRefOperation={runRefOperation}
						setInteractiveRebaseOpen={setInteractiveRebaseOpen}
						setPendingRefAction={setPendingRefAction}
					/>
				) : null}
				{mainViewMode === "graph" &&
				pendingGraphAction &&
				pendingGraphActionPresentation ? (
					<GraphActionDialog
						pendingGraphActionPresentation={pendingGraphActionPresentation}
						graphActionRunning={graphActionRunning}
						setPendingGraphAction={setPendingGraphAction}
						pendingGraphAction={pendingGraphAction}
						graphActionName={graphActionName}
						setGraphActionName={setGraphActionName}
						graphActionMessage={graphActionMessage}
						setGraphActionMessage={setGraphActionMessage}
						graphActionResult={graphActionResult}
						runGraphAction={runGraphAction}
					/>
				) : null}
				{mainViewMode === "graph" &&
				repositoryOperation.kind !== "idle" &&
				!pendingRefAction ? (
					<RepositoryOperationBar
						repositoryOperation={repositoryOperation}
						resumableOperation={resumableOperation}
						refOperationRunning={refOperationRunning}
						runRefOperation={runRefOperation}
					/>
				) : null}
			</div>
		</section>
	);
}

export { DiffFilePath } from "./DiffFilePath.tsx";
export { styles } from "./styles.ts";
export type {
	DragProps,
	GitGraphActionResult,
	GitOperationActivityPhase,
	GitOperationErrorKind,
	GitOperationOutcome,
	GitRefOperationPreflight,
	GitRefOperationResult,
	GraphActionPresentation,
} from "./useChatDiffPanelState.tsx";
export {
	gitOperationErrorLabel,
	graphActionPresentation,
} from "./useChatDiffPanelState.tsx";
