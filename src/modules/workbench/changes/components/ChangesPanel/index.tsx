import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo } from "solid-js";
import type { GitCommitDetails } from "../../../../../../build/presentation/contracts/GitCommitDetails.ts";
import type { GitCommitFile } from "../../../../../../build/presentation/contracts/GitCommitFile.ts";
import type { GitComparisonDetails } from "../../../../../../build/presentation/contracts/GitComparisonDetails.ts";
import type { GitFileEntry } from "../../../../../../build/presentation/contracts/GitFileEntry.ts";
import type { GitFilePresentation } from "../../../../../../build/presentation/contracts/GitFilePresentation.ts";
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
	prefetchKey?: string;
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
	const filePresentation = createMemo(() => props.filePresentation);
	const _source2 = createMemo(() => {
		const _sourceValue = props;
		return rustProject<{
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
			content: _sourceValue.content,
			fileViewMode: _sourceValue.fileViewMode,
			filePresentation: filePresentation(),
			modified: _sourceValue.modified,
			untracked: _sourceValue.untracked,
			staged: _sourceValue.staged,
			selectedCommitHash: _sourceValue.selectedCommitHash,
			selectedCommitCount:
				_sourceValue.selectedCommitCount === undefined
					? _sourceValue.selectedCommitHash
						? 1
						: 0
					: _sourceValue.selectedCommitCount,
			commitDetailsLoading: _sourceValue.commitDetailsLoading,
			commitDetails: _sourceValue.commitDetails,
			commitDetailsError: _sourceValue.commitDetailsError,
			comparisonDetailsLoading:
				_sourceValue.comparisonDetailsLoading === undefined
					? false
					: _sourceValue.comparisonDetailsLoading,
			comparisonDetails: _sourceValue.comparisonDetails ?? null,
		});
	});
	const prefetchFiles = createMemo(() =>
		_source2().showingWorkingTree
			? rustProject<GitFileEntry[]>("diffPrefetchFiles", {
					files: _source2().navigableFiles,
					selected: props.selectedFile,
				})
			: [],
	);
	createEffect(
		() => [prefetchFiles(), props.prefetchKey] as const,
		([files]) => props.onPrefetchFiles?.(files),
	);

	const selectAdjacentFile = (direction: -1 | 1) => {
		const _source2Value = _source2(),
			_sourceValue3 = props;
		if (!_source2Value.showingWorkingTree) {
			const nextFile = adjacentGitFile(
				_source2Value.navigableHistoricalFiles,
				(file) => file.path === props.selectedFile?.path,
				direction,
				true,
			);
			if (!nextFile) return;
			if (
				(_sourceValue3.selectedCommitCount === undefined
					? _sourceValue3.selectedCommitHash
						? 1
						: 0
					: _sourceValue3.selectedCommitCount) > 1
			)
				_sourceValue3.onSelectComparisonFile?.(nextFile);
			else _sourceValue3.onSelectCommitFile?.(nextFile);
			return;
		}
		const nextFile = adjacentGitFile(
			_source2Value.navigableFiles,
			(file) => {
				const _sourceValue2 = props;
				return (
					file.path === _sourceValue2.selectedFile?.path &&
					file.staged === _sourceValue2.selectedFile?.staged
				);
			},
			direction,
			true,
		);
		if (nextFile) _sourceValue3.onSelectFile(nextFile);
	};
	const toggleSelectedFile = () => {
		const _sourceValue5 = props,
			_source2Value2 = _source2();
		if (!_sourceValue5.selectedFile) return;
		const file =
			_source2Value2.workingFiles.find((candidate) => {
				const _sourceValue4 = props;
				return (
					candidate.path === _sourceValue4.selectedFile?.path &&
					candidate.staged === _sourceValue4.selectedFile?.staged
				);
			}) ??
			_source2Value2.workingFiles.find(
				(candidate) => candidate.path === props.selectedFile?.path,
			);
		if (!file) return;
		const nextSelection = getFileSelectionAfterToggle(
			_source2Value2.navigableFiles,
			_sourceValue5.selectedFile,
		);
		if (file.staged) _sourceValue5.onUnstageFile(file.path);
		else _sourceValue5.onStageFile(file.path);
		if (nextSelection) _sourceValue5.onSelectFile(nextSelection);
	};
	return (
		<div
			{...stylex.attrs(styles.root)}
			ref={captureEvent("keydown", (event) =>
				((event) => {
					const target = event.target as HTMLElement;
					const keyboardContext = target.closest(
						"[data-git-commit-message], [data-git-file-select]",
					);
					if (
						!keyboardContext ||
						event.metaKey ||
						event.ctrlKey ||
						event.altKey
					)
						return;
					if (event.key === "ArrowUp" || event.key === "ArrowDown") {
						event.preventDefault();
						selectAdjacentFile(event.key === "ArrowUp" ? -1 : 1);
					} else if (
						event.key === "Enter" &&
						_source2().showingWorkingTree &&
						props.selectedFile
					) {
						event.preventDefault();
						toggleSelectedFile();
					}
				})?.(event),
			)}
		>
			<ChangesPanelHeader
				onCollapse={props.onCollapse}
				onOpenGraph={props.onOpenGraph}
				graphActive={props.graphActive}
				additions={_source2().additions}
				deletions={_source2().deletions}
				fileViewMode={props.fileViewMode}
				onFileViewModeChange={props.onFileViewModeChange}
				showFileControls={props.hasProject}
				worktreePath={props.selectedWorktreePath}
				onOpenWorktree={props.onOpenWorktree}
			/>

			{_source2().showingWorkingTree && (
				<WorkingTreeFiles
					hasProject={props.hasProject}
					projectLoading={
						props.projectLoading === undefined ? false : props.projectLoading
					}
					filePresentation={filePresentation()}
					unstagedFiles={_source2().unstagedFiles}
					stagedFiles={_source2().stagedFiles}
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
				_source2().showingWorkingTree &&
				(props.showCommitSection === undefined
					? true
					: props.showCommitSection) && (
					<CommitSection
						cwd={props.cwd}
						commitMessage={props.commitMessage}
						onCommitMessageChange={props.onCommitMessageChange}
						onCommit={props.onCommit}
						isCommitting={props.isCommitting}
						stagedCount={_source2().stagedFiles.length}
					/>
				)}

			{!_source2().showingWorkingTree && (
				<HistoryFiles
					historyLoading={_source2().historyLoading}
					historyDetails={_source2().historyDetails}
					selectionCount={
						_source2().comparing
							? props.selectedCommitCount === undefined
								? props.selectedCommitHash
									? 1
									: 0
								: props.selectedCommitCount
							: undefined
					}
					selectedFile={props.selectedFile}
					onSelectFile={
						_source2().comparing
							? props.onSelectComparisonFile
							: props.onSelectCommitFile
					}
					fileViewMode={props.fileViewMode}
					historyMessage={_source2().historyMessage}
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
