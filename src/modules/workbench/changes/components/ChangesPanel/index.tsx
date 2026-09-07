import * as stylex from "@octanejs/stylex";
import { memo, useMemo } from "octane";
import type { GitCommitDetails } from "../../../../../../build/presentation/contracts/GitCommitDetails.ts";
import type { GitCommitFile } from "../../../../../../build/presentation/contracts/GitCommitFile.ts";
import type { GitComparisonDetails } from "../../../../../../build/presentation/contracts/GitComparisonDetails.ts";
import type { GitFileEntry } from "../../../../../../build/presentation/contracts/GitFileEntry.ts";
import type { GitFilePresentation } from "../../../../../../build/presentation/contracts/GitFilePresentation.ts";
import {
	adjacentGitFile,
	getFileSelectionAfterToggle,
	project as rustProject,
} from "../../../../../adapters/presentation/model.ts";
import { ChangesPanelHeader } from "./ChangesPanelHeader.tsx";
import { CommitSection } from "./CommitSection.tsx";
import { HistoryFiles } from "./HistoryFiles.tsx";
import { styles } from "./styles.ts";
import { WorkingTreeFiles } from "./WorkingTreeFiles.tsx";

interface ChangesPanelProps {
	filePresentation?: GitFilePresentation;
	cwd?: string;
	fileViewMode: "path" | "tree";
	onFileViewModeChange: (mode: "path" | "tree") => void;
	content: "workingTree" | "history";
	graphActive: boolean;
	modified: GitFileEntry[];
	untracked: GitFileEntry[];
	staged: GitFileEntry[];
	selectedFile: SelectedFile | null;
	onSelectFile: (f: GitFileEntry) => void;
	onStageFile: (path: string) => void;
	onUnstageFile: (path: string) => void;
	onStageAll: () => void;
	onUnstageAll: () => void;
	hasProject: boolean;
	projectLoading?: boolean;
	selectedCommitHash: string | null;
	selectedCommitCount?: number;
	selectedWorktreePath?: string;
	onOpenWorktree?: () => void;
	commitDetailsLoading: boolean;
	commitDetails: GitCommitDetails | null;
	commitDetailsError?: string | null;
	comparisonDetailsLoading?: boolean;
	comparisonDetails?: GitComparisonDetails | null;
	onSelectCommitFile?: (file: GitCommitFile) => void;
	onSelectComparisonFile?: (file: GitCommitFile) => void;
	branch?: string;
	commitMessage: string;
	onCommitMessageChange: (msg: string) => void;
	onCommit: () => void;
	isCommitting: boolean;
	showFileActions?: boolean;
	showCommitSection?: boolean;
	onCollapse?: () => void;
	onOpenGraph?: () => void;
}

export const ChangesPanel = memo(function ChangesPanel(
	props: ChangesPanelProps,
) {
	const {
		fileViewMode,
		onFileViewModeChange,
		content,
		graphActive,
		modified,
		untracked,
		staged,
		selectedFile,
		onSelectFile,
		onStageFile,
		onUnstageFile,
		onStageAll,
		onUnstageAll,
		hasProject,
		projectLoading = false,
		selectedCommitHash,
		selectedCommitCount = selectedCommitHash ? 1 : 0,
		selectedWorktreePath,
		onOpenWorktree,
		commitDetailsLoading,
		commitDetails,
		commitDetailsError,
		comparisonDetailsLoading = false,
		comparisonDetails,
		onSelectCommitFile,
		onSelectComparisonFile,
		commitMessage,
		onCommitMessageChange,
		onCommit,
		isCommitting,
		cwd,
		showFileActions = false,
		showCommitSection = true,
		onCollapse,
		onOpenGraph,
	} = props;
	const filePresentation = props.filePresentation;
	const {
		unstagedFiles,
		stagedFiles,
		workingFiles,
		navigableFiles,
		showingWorkingTree,
		comparing,
		historyDetails,
		historyLoading,
		historyMessage,
		navigableHistoricalFiles,
		additions,
		deletions,
	} = useMemo(
		() =>
			rustProject<{
				unstagedFiles: GitFileEntry[];
				stagedFiles: GitFileEntry[];
				workingFiles: GitFileEntry[];
				navigableFiles: GitFileEntry[];
				showingWorkingTree: boolean;
				comparing: boolean;
				historyDetails: GitCommitDetails | GitComparisonDetails | null;
				historyLoading: boolean;
				historyMessage: string;
				navigableHistoricalFiles: GitCommitFile[];
				additions: number;
				deletions: number;
			}>("changesPanel", {
				content,
				fileViewMode,
				filePresentation,
				modified,
				untracked,
				staged,
				selectedCommitHash,
				selectedCommitCount,
				commitDetailsLoading,
				commitDetails,
				commitDetailsError,
				comparisonDetailsLoading,
				comparisonDetails: comparisonDetails ?? null,
			}),
		[
			content,
			fileViewMode,
			filePresentation,
			modified,
			untracked,
			staged,
			selectedCommitHash,
			selectedCommitCount,
			commitDetailsLoading,
			commitDetails,
			commitDetailsError,
			comparisonDetailsLoading,
			comparisonDetails,
		],
	);
	const selectAdjacentFile = (direction: -1 | 1) => {
		if (!showingWorkingTree) {
			const nextFile = adjacentGitFile(
				navigableHistoricalFiles,
				(file) => file.path === selectedFile?.path,
				direction,
				true,
			);
			if (!nextFile) return;
			if (selectedCommitCount > 1) onSelectComparisonFile?.(nextFile);
			else onSelectCommitFile?.(nextFile);
			return;
		}
		const nextFile = adjacentGitFile(
			navigableFiles,
			(file) =>
				file.path === selectedFile?.path &&
				file.staged === selectedFile?.staged,
			direction,
			true,
		);
		if (nextFile) onSelectFile(nextFile);
	};
	const toggleSelectedFile = () => {
		if (!selectedFile) return;
		const file =
			workingFiles.find(
				(candidate) =>
					candidate.path === selectedFile.path &&
					candidate.staged === selectedFile.staged,
			) ??
			workingFiles.find((candidate) => candidate.path === selectedFile.path);
		if (!file) return;
		const nextSelection = getFileSelectionAfterToggle(
			navigableFiles,
			selectedFile,
		);
		if (file.staged) onUnstageFile(file.path);
		else onStageFile(file.path);
		if (nextSelection) onSelectFile(nextSelection);
	};
	return (
		<div
			{...stylex.props(styles.root)}
			onKeyDownCapture={(event) => {
				const target = event.target as HTMLElement;
				const keyboardContext = target.closest(
					"[data-git-commit-message], [data-git-file-select]",
				);
				if (!keyboardContext || event.metaKey || event.ctrlKey || event.altKey)
					return;
				if (event.key === "ArrowUp" || event.key === "ArrowDown") {
					event.preventDefault();
					selectAdjacentFile(event.key === "ArrowUp" ? -1 : 1);
				} else if (
					event.key === "Enter" &&
					showingWorkingTree &&
					selectedFile
				) {
					event.preventDefault();
					toggleSelectedFile();
				}
			}}
		>
			<ChangesPanelHeader
				onCollapse={onCollapse}
				onOpenGraph={onOpenGraph}
				graphActive={graphActive}
				additions={additions}
				deletions={deletions}
				fileViewMode={fileViewMode}
				onFileViewModeChange={onFileViewModeChange}
				showFileControls={hasProject}
				worktreePath={selectedWorktreePath}
				onOpenWorktree={onOpenWorktree}
			/>

			{showingWorkingTree && (
				<WorkingTreeFiles
					hasProject={hasProject}
					projectLoading={projectLoading}
					filePresentation={filePresentation}
					unstagedFiles={unstagedFiles}
					stagedFiles={stagedFiles}
					selectedFile={selectedFile}
					onSelectFile={onSelectFile}
					showFileActions={showFileActions}
					onStageFile={onStageFile}
					onUnstageFile={onUnstageFile}
					onStageAll={onStageAll}
					onUnstageAll={onUnstageAll}
					fileViewMode={fileViewMode}
				/>
			)}

			{hasProject && showingWorkingTree && showCommitSection && (
				<CommitSection
					cwd={cwd}
					commitMessage={commitMessage}
					onCommitMessageChange={onCommitMessageChange}
					onCommit={onCommit}
					isCommitting={isCommitting}
					stagedCount={stagedFiles.length}
				/>
			)}

			{!showingWorkingTree && (
				<HistoryFiles
					historyLoading={historyLoading}
					historyDetails={historyDetails}
					selectionCount={comparing ? selectedCommitCount : undefined}
					selectedFile={selectedFile}
					onSelectFile={comparing ? onSelectComparisonFile : onSelectCommitFile}
					fileViewMode={fileViewMode}
					historyMessage={historyMessage}
				/>
			)}
		</div>
	);
});

export {
	getFileSelectionAfterToggle,
	visibleGitFiles,
} from "../../../../../adapters/presentation/model.ts";
export { CollapsedChangesPanel } from "./CollapsedChangesPanel.tsx";

export interface SelectedFile {
	path: string;
	staged: boolean;
}
