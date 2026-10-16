import { DiffViewer } from "@repository/components/diff/components/DiffViewer/index.tsx";
import type { GraphSelectionIntent } from "@repository/components/graph/components/CommitGraph/index.tsx";
import { CommitGraph } from "@repository/components/graph/components/CommitGraph/index.tsx";
import type { GraphPreferences } from "@repository/components/graph/components/CommitGraph/useCommitGraphState.tsx";
import type { useGitGraph } from "@repository/hooks/useGitGraph.tsx";
import { ErrorBoundary } from "@shared/ui/ErrorBoundary/index.tsx";
import * as stylex from "@stylexjs/stylex";
import type { ComponentProps } from "solid-js";
import { GraphActionDialog } from "./GraphActionDialog.tsx";
import { OperationToast } from "./OperationToast.tsx";
import {
	RefOperationDialog,
	RepositoryOperationBar,
} from "./RefOperationDialog.tsx";
import { styles } from "./styles.ts";
import { useGitOperations } from "./useGitOperations.tsx";
import { ViewerHeader } from "./ViewerHeader.tsx";

function gitGraphEmptyLabel(graph: ReturnType<typeof useGitGraph>): string {
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
	props: Omit<ComponentProps<typeof ViewerHeader>, "operations"> &
		ReturnType<Parameters<typeof useGitOperations>[0]> & {
			readonly loading: boolean;
			readonly error?: string;
			readonly graphPreferences: GraphPreferences;
			readonly onGraphPreferencesChange: (
				update:
					| GraphPreferences
					| ((current: GraphPreferences) => GraphPreferences),
			) => void;
			readonly graphLoading: boolean;
			readonly graphError: string | null;
			readonly selectionAnnouncement: string;
			readonly selectedCommitHash: string | null;
			readonly selectedCommitIds: readonly string[];
			readonly onSelectCommit: (
				itemId: string,
				intent?: GraphSelectionIntent,
			) => void;
			readonly onOpenGraphSelection: (itemId: string) => void;
			readonly onCheckoutRef: (ref: string) => void;
			readonly onLoadMoreCommits: () => void;
			readonly startAtFirstChange: boolean;
		},
) {
	const operations = useGitOperations(() => props);
	const { state } = operations;
	let panel: HTMLElement | undefined;
	const returnGraphFocus = () =>
		panel?.querySelector<HTMLElement>(
			'[aria-label="Repository commit history"]',
		);
	return (
		<section
			ref={(element) => {
				panel = element;
			}}
			{...stylex.attrs(styles.viewerPanel)}
		>
			<span role="status" aria-live="polite" {...stylex.attrs(styles.srStatus)}>
				{props.selectionAnnouncement}
			</span>
			<ViewerHeader {...props} operations={operations} />
			{props.mainViewMode === "graph" ? (
				<OperationToast
					phase={operations.operationModel().operationActivity.phase}
					message={
						state.graphActionRunning && operations.presentation()
							? `${operations.presentation()!.confirm} in progress…`
							: operations.operationModel().operationActivity.message
					}
				/>
			) : null}
			<div {...stylex.attrs(styles.viewerBody)}>
				{props.mainViewMode === "graph" ? (
					props.graphLoading &&
					props.graph.commits.length === 0 &&
					!props.graph.searchQuery ? (
						<div {...stylex.attrs(styles.viewerEmpty)}>Loading history…</div>
					) : props.graphError &&
						props.graph.commits.length === 0 &&
						!props.graph.searchQuery ? (
						<div {...stylex.attrs(styles.viewerEmpty)}>{props.graphError}</div>
					) : props.graph.commits.length === 0 && !props.graph.searchQuery ? (
						<div {...stylex.attrs(styles.viewerEmpty)}>
							{gitGraphEmptyLabel(props.graph)}
						</div>
					) : (
						<CommitGraph
							commits={props.graph.commits}
							onSearchChange={props.graph.setSearchQuery}
							searchActive={Boolean(props.graph.searchQuery)}
							searchQuery={props.graph.searchQuery}
							emptyLabel={
								props.graphLoading
									? "Searching history…"
									: (props.graphError ??
										props.graph.stateError ??
										"No matching commits")
							}
							rows={props.graph.rows}
							presentation={props.graph.presentation}
							preferences={props.graphPreferences}
							onPreferencesChange={props.onGraphPreferencesChange}
							worktrees={props.graph.worktrees}
							selectedHash={props.selectedCommitHash ?? undefined}
							selectedIds={props.selectedCommitIds}
							onSelect={props.onSelectCommit}
							onOpenSelection={props.onOpenGraphSelection}
							onCheckoutRef={props.onCheckoutRef}
							branch={props.branch}
							hasMore={props.graph.hasMore}
							loadingMore={props.graph.loading}
							repositoryKey={props.repositoryKey}
							onLoadMore={props.onLoadMoreCommits}
							onRefDrop={(source, target) => {
								operations.update({
									refOperationResult: null,
									pendingRefAction: { source, target },
								});
							}}
							onGraphAction={operations.requestGraphAction}
							onCompareWithWip={(itemId) => {
								const wip = props.graph.commits.find(
									(item) =>
										item.itemKind === "worktreeWip" && item.id === "wip",
								);
								if (!wip) return;
								props.onSelectCommit(wip.id);
								props.onSelectCommit(itemId, {
									additive: true,
									range: false,
								});
							}}
						/>
					)
				) : props.diff && props.file ? (
					<ErrorBoundary
						label="Diff viewer"
						contained
						resetKey={`${props.file.path}:${props.file.staged}`}
					>
						<DiffViewer
							diff={props.diff}
							filePath={props.file.path}
							staged={props.file.staged}
							viewMode={props.viewMode}
							startAtFirstChange={props.startAtFirstChange}
						/>
					</ErrorBoundary>
				) : !props.loading ? (
					<div {...stylex.attrs(styles.viewerEmpty)}>
						{props.error ?? "No diff available"}
					</div>
				) : null}
				{props.mainViewMode === "graph" && state.pendingRefAction ? (
					<RefOperationDialog
						returnFocus={returnGraphFocus}
						operations={operations}
						pendingRefAction={state.pendingRefAction}
					/>
				) : null}
				{props.mainViewMode === "graph" &&
				operations.dialogOpen() &&
				state.pendingGraphAction &&
				operations.presentation() ? (
					<GraphActionDialog
						returnFocus={returnGraphFocus}
						operations={operations}
						pendingGraphActionPresentation={operations.presentation()!}
						pendingGraphAction={state.pendingGraphAction}
					/>
				) : null}
				{props.mainViewMode === "graph" &&
				operations.operationModel().recoveryTitle &&
				!state.pendingRefAction ? (
					<RepositoryOperationBar operations={operations} />
				) : null}
			</div>
		</section>
	);
}
