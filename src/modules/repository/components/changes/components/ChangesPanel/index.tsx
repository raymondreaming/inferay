import type {
	GitCommitDetails,
	GitCommitFile,
	GitComparisonDetails,
	GitFileEntry,
	GitFilePresentation,
	SelectedPanelFile,
} from "@contracts";
import { project as rustProject } from "@shared/lib/native.tsx";
import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo } from "solid-js";
import { ChangesPanelHeader } from "./ChangesPanelHeader.tsx";
import { CommitSection } from "./CommitSection.tsx";
import { HistoryFiles } from "./HistoricalDetailsPanel.tsx";
import { styles } from "./styles.ts";
import { WorkingTreeFiles } from "./WorkingTreeFiles.tsx";

export type SelectedFile = Pick<SelectedPanelFile, "path" | "staged">;

export type ChangesPanelModel = {
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
};

export const ChangesPanel = function ChangesPanel(props: {
	onPrefetchFiles?: (files: GitFileEntry[]) => void;
	filePresentation?: GitFilePresentation;
	cwd?: string;
	fileViewMode: "path" | "tree";
	onFileViewModeChange: (mode: "path" | "tree") => void;
	model: ChangesPanelModel;
	graphActive: boolean;
	selectedFile: SelectedFile | null;
	onSelectFile: (f: GitFileEntry) => void;
	onStageFile: (path: string) => void;
	onUnstageFile: (path: string) => void;
	onStageAll: () => void;
	onUnstageAll: () => void;
	onStashFile: (path: string) => void;
	onDiscard: (staged: boolean, path?: string) => void;
	hasProject: boolean;
	projectLoading?: boolean;
	selectedCommitCount?: number;
	selectedWorktreePath?: string;
	onOpenWorktree?: () => void;
	onSelectCommitFile?: (file: GitCommitFile) => void;
	onSelectComparisonFile?: (file: GitCommitFile) => void;
	commitMessage: string;
	onCommitMessageChange: (msg: string) => void;
	onCommit: () => void;
	isCommitting: boolean;
	showFileActions?: boolean;
	showCommitSection?: boolean;
	onCollapse?: () => void;
	onOpenGraph?: () => void;
}) {
	const prefetchFiles = createMemo(() =>
		props.model.showingWorkingTree
			? rustProject<GitFileEntry[]>("diffPrefetchFiles", {
					files: props.model.navigableFiles,
					selected: props.selectedFile,
				})
			: [],
	);
	createEffect(
		() => [prefetchFiles(), props.onPrefetchFiles] as const,
		([files, prefetch]) => prefetch?.(files),
	);

	return (
		<div {...stylex.attrs(styles.root)}>
			<ChangesPanelHeader
				onCollapse={props.onCollapse}
				onOpenGraph={props.onOpenGraph}
				graphActive={props.graphActive}
				additions={props.model.additions}
				deletions={props.model.deletions}
				fileViewMode={props.fileViewMode}
				onFileViewModeChange={props.onFileViewModeChange}
				showFileControls={props.hasProject}
				worktreePath={props.selectedWorktreePath}
				onOpenWorktree={props.onOpenWorktree}
			/>

			{props.model.showingWorkingTree && (
				<WorkingTreeFiles
					hasProject={props.hasProject}
					projectLoading={
						props.projectLoading === undefined ? false : props.projectLoading
					}
					filePresentation={props.filePresentation}
					unstagedFiles={props.model.unstagedFiles}
					stagedFiles={props.model.stagedFiles}
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
					onStashFile={props.onStashFile}
					onDiscard={props.onDiscard}
					fileViewMode={props.fileViewMode}
				/>
			)}

			{props.hasProject &&
				props.model.showingWorkingTree &&
				(props.showCommitSection === undefined
					? true
					: props.showCommitSection) && (
					<CommitSection
						cwd={props.cwd}
						commitMessage={props.commitMessage}
						onCommitMessageChange={props.onCommitMessageChange}
						onCommit={props.onCommit}
						isCommitting={props.isCommitting}
						stagedCount={props.model.stagedFiles.length}
					/>
				)}

			{!props.model.showingWorkingTree && (
				<HistoryFiles
					cwd={props.cwd}
					historyLoading={props.model.historyLoading}
					historyDetails={props.model.historyDetails}
					selectionCount={
						props.model.comparing ? props.selectedCommitCount : undefined
					}
					selectedFile={props.selectedFile}
					onSelectFile={
						props.model.comparing
							? props.onSelectComparisonFile
							: props.onSelectCommitFile
					}
					fileViewMode={props.fileViewMode}
					historyMessage={props.model.historyMessage}
				/>
			)}
		</div>
	);
};
