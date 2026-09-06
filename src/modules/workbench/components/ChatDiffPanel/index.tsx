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
	const view = useChatDiffPanelState(props);
	return (
		<section {...stylex.props(styles.viewerPanel)}>
			<span role="status" aria-live="polite" {...stylex.props(styles.srStatus)}>
				{view.selectionAnnouncement}
			</span>
			<span
				role="status"
				aria-live="polite"
				data-git-operation-phase={view.operationActivity.phase}
				{...stylex.props(styles.srStatus)}
			>
				{view.operationActivity.message}
			</span>
			<div
				aria-hidden="true"
				data-floating-viewer-scrim="true"
				{...stylex.props(
					styles.viewerFloatingScrim,
					view.mainViewMode === "graph" &&
						styles.viewerFloatingScrimAboveContent,
				)}
			/>
			<ViewerHeader {...view} />
			<div
				{...stylex.props(
					styles.viewerBody,
					view.mainViewMode !== "graph" && styles.viewerBodyAboveScrim,
				)}
			>
				{view.mainViewMode === "graph" ? (
					view.graphLoading &&
					view.graph.commits.length === 0 &&
					!view.graph.searchQuery ? (
						<div {...stylex.props(styles.viewerEmpty)}>Loading history…</div>
					) : view.graphError &&
						view.graph.commits.length === 0 &&
						!view.graph.searchQuery ? (
						<div {...stylex.props(styles.viewerEmpty)}>{view.graphError}</div>
					) : view.graph.commits.length === 0 && !view.graph.searchQuery ? (
						<div {...stylex.props(styles.viewerEmpty)}>
							{gitGraphEmptyLabel(view.graph)}
						</div>
					) : (
						<CommitGraph
							commits={view.graph.commits}
							ancestry={view.graph.ancestry}
							onSearchChange={view.graph.setSearchQuery}
							searchActive={Boolean(view.graph.searchQuery)}
							searchQuery={view.graph.searchQuery}
							emptyLabel={
								view.graphLoading
									? "Searching history…"
									: (view.graphError ??
										view.graph.stateError ??
										"No matching commits")
							}
							rows={view.graph.rows}
							worktrees={view.graph.worktrees}
							selectedHash={view.selectedCommitHash ?? undefined}
							selectedIds={view.selectedCommitIds}
							onSelect={view.onSelectCommit}
							onOpenSelection={view.onOpenGraphSelection}
							onCheckoutRef={view.onCheckoutRef}
							branch={view.branch}
							embedded
							hasMore={view.graph.hasMore}
							loadingMore={view.graph.loading}
							repositoryKey={view.repositoryKey}
							onLoadMore={view.onLoadMoreCommits}
							onRefDrop={(source, target) => {
								view.setRefOperationResult(null);
								view.setInteractiveRebaseOpen(false);
								view.setPendingRefAction({ source, target });
							}}
							onGraphAction={view.requestGraphAction}
							onCompareWithWip={(itemId) => {
								const wip = view.graph.commits.find(
									(item) =>
										item.itemKind === "worktreeWip" && item.id === "wip",
								);
								if (!wip) return;
								view.onSelectCommit(wip.id);
								view.onSelectCommit(itemId, { additive: true, range: false });
							}}
						/>
					)
				) : view.diff && view.file ? (
					<DiffViewerBoundary
						resetKey={`${view.file.path}:${view.file.staged}`}
					>
						<DiffViewer
							diff={view.diff}
							filePath={view.file.path}
							staged={view.file.staged}
							onClose={view.onClose}
							hideHeader
							hideToolbar
							viewMode={view.viewMode}
							onViewModeChange={view.onViewModeChange}
							startAtFirstChange={view.startAtFirstChange}
						/>
					</DiffViewerBoundary>
				) : !view.loading ? (
					<div {...stylex.props(styles.viewerEmpty)}>
						{view.error ?? "No diff available"}
					</div>
				) : null}
				{view.mainViewMode === "graph" && view.pendingRefAction ? (
					<RefOperationDialog
						{...view}
						pendingRefAction={view.pendingRefAction}
					/>
				) : null}
				{view.mainViewMode === "graph" &&
				view.pendingGraphAction &&
				view.pendingGraphActionPresentation ? (
					<GraphActionDialog
						{...view}
						pendingGraphActionPresentation={view.pendingGraphActionPresentation}
						pendingGraphAction={view.pendingGraphAction}
					/>
				) : null}
				{view.mainViewMode === "graph" &&
				view.repositoryOperation.kind !== "idle" &&
				!view.pendingRefAction ? (
					<RepositoryOperationBar {...view} />
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
