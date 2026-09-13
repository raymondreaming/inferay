import type {
	GitCommitDetails,
	GitCommitFile,
	GitComparisonDetails,
	GitFileEntry,
	GitFilePresentation,
} from "@contracts";
import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo } from "solid-js";
import { captureEvent } from "../../../../../shared/lib/dom.tsx";
import {
	adjacentGitFile,
	getFileSelectionAfterToggle,
	project as rustProject,
} from "../../../../../shared/lib/native.tsx";
import { ChangesPanelHeader } from "./ChangesPanelHeader.tsx";
import { CommitSection } from "./CommitSection.tsx";
import { HistoryFiles } from "./HistoryFiles.tsx";
import { styles } from "./styles.ts";
import { WorkingTreeFiles } from "./WorkingTreeFiles.tsx";

interface ChangesPanelProps {
	onPrefetchFiles?: (files: GitFileEntry[]) => void;
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
export const ChangesPanel = function ChangesPanel(props: ChangesPanelProps) {
	const selectedCommitCount = createMemo(
		() => props.selectedCommitCount ?? (props.selectedCommitHash ? 1 : 0),
	);
	const model = createMemo(() => {
		return rustProject<{
			unstagedFiles: GitFileEntry[];
			stagedFiles: GitFileEntry[];
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
			content: props.content,
			fileViewMode: props.fileViewMode,
			filePresentation: props.filePresentation,
			modified: props.modified,
			untracked: props.untracked,
			staged: props.staged,
			selectedCommitHash: props.selectedCommitHash,
			selectedCommitCount: selectedCommitCount(),
			commitDetailsLoading: props.commitDetailsLoading,
			commitDetails: props.commitDetails,
			commitDetailsError: props.commitDetailsError,
			comparisonDetailsLoading: props.comparisonDetailsLoading,
			comparisonDetails: props.comparisonDetails ?? null,
		});
	});
	const prefetchFiles = createMemo(() =>
		model().showingWorkingTree
			? rustProject<GitFileEntry[]>("diffPrefetchFiles", {
					files: model().navigableFiles,
					selected: props.selectedFile,
				})
			: [],
	);
	createEffect(
		() => [prefetchFiles(), props.onPrefetchFiles] as const,
		([files, prefetch]) => prefetch?.(files),
	);

	const selectAdjacentFile = (direction: -1 | 1) => {
		const state = model();
		const selected = props.selectedFile;
		if (state.showingWorkingTree) {
			const next = adjacentGitFile(
				state.navigableFiles,
				(file) =>
					file.path === selected?.path && file.staged === selected.staged,
				direction,
				true,
			);
			if (next) props.onSelectFile(next);
		} else {
			const next = adjacentGitFile(
				state.navigableHistoricalFiles,
				(file) => file.path === selected?.path,
				direction,
				true,
			);
			if (next)
				(state.comparing
					? props.onSelectComparisonFile
					: props.onSelectCommitFile)?.(next);
		}
	};
	const toggleSelectedFile = () => {
		const selected = props.selectedFile;
		if (!selected) return;
		const files = model().navigableFiles;
		const file =
			files.find(
				(file) =>
					file.path === selected.path && file.staged === selected.staged,
			) ?? files.find((file) => file.path === selected.path);
		if (!file) return;
		const next = getFileSelectionAfterToggle(files, selected);
		(file.staged ? props.onUnstageFile : props.onStageFile)(file.path);
		if (next) props.onSelectFile(next);
	};
	return (
		<div
			{...stylex.attrs(styles.root)}
			ref={captureEvent("keydown", (event) => {
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
					model().showingWorkingTree &&
					props.selectedFile
				) {
					event.preventDefault();
					toggleSelectedFile();
				}
			})}
		>
			<ChangesPanelHeader
				onCollapse={props.onCollapse}
				onOpenGraph={props.onOpenGraph}
				graphActive={props.graphActive}
				additions={model().additions}
				deletions={model().deletions}
				fileViewMode={props.fileViewMode}
				onFileViewModeChange={props.onFileViewModeChange}
				showFileControls={props.hasProject}
				worktreePath={props.selectedWorktreePath}
				onOpenWorktree={props.onOpenWorktree}
			/>

			{model().showingWorkingTree && (
				<WorkingTreeFiles
					hasProject={props.hasProject}
					projectLoading={
						props.projectLoading === undefined ? false : props.projectLoading
					}
					filePresentation={props.filePresentation}
					unstagedFiles={model().unstagedFiles}
					stagedFiles={model().stagedFiles}
					selectedFile={props.selectedFile}
					onSelectFile={props.onSelectFile}
					onPrefetchFile={(file) =>
						props.onPrefetchFiles?.(
							file ? [file, ...prefetchFiles()] : prefetchFiles(),
						)
					}
					showFileActions={
						props.showFileActions === undefined ? false : props.showFileActions
					}
					onStageFile={props.onStageFile}
					onUnstageFile={props.onUnstageFile}
					onStageAll={props.onStageAll}
					onUnstageAll={props.onUnstageAll}
					fileViewMode={props.fileViewMode}
				/>
			)}

			{props.hasProject &&
				model().showingWorkingTree &&
				(props.showCommitSection === undefined
					? true
					: props.showCommitSection) && (
					<CommitSection
						cwd={props.cwd}
						commitMessage={props.commitMessage}
						onCommitMessageChange={props.onCommitMessageChange}
						onCommit={props.onCommit}
						isCommitting={props.isCommitting}
						stagedCount={model().stagedFiles.length}
					/>
				)}

			{!model().showingWorkingTree && (
				<HistoryFiles
					historyLoading={model().historyLoading}
					historyDetails={model().historyDetails}
					selectionCount={model().comparing ? selectedCommitCount() : undefined}
					selectedFile={props.selectedFile}
					onSelectFile={
						model().comparing
							? props.onSelectComparisonFile
							: props.onSelectCommitFile
					}
					fileViewMode={props.fileViewMode}
					historyMessage={model().historyMessage}
				/>
			)}
		</div>
	);
};

export {
	getFileSelectionAfterToggle,
	visibleGitFiles,
} from "../../../../../shared/lib/native.tsx";
export { CollapsedChangesPanel } from "./CollapsedChangesPanel.tsx";
export interface SelectedFile {
	path: string;
	staged: boolean;
}
