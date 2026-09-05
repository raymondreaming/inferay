import * as stylex from "@octanejs/stylex";
import { memo, useMemo } from "octane";
import { DotMatrixWeave } from "../../../../../shared/ui/DotMatrixLoader/index.tsx";
import type {
	CommitDetails,
	CommitFile,
	ComparisonDetails,
} from "../../../../repository/hooks/useGitGraph.tsx";
import type {
	GitFileEntry,
	GitFilePresentation,
} from "../../../../repository/model/types.ts";
import {
	type SelectedFile,
	visibleGitFiles,
} from "../../../model/workbench-model.ts";
import { ChangesPanelHeader } from "./ChangesPanelHeader.tsx";
import { CommitDetailsPanel } from "./CommitDetailsPanel.tsx";
import { CommitSection } from "./CommitSection.tsx";
import { ComparisonDetailsPanel } from "./ComparisonDetailsPanel.tsx";
import { FileGroup } from "./FileGroup.tsx";
import { styles } from "./styles.ts";

export function getFileSelectionAfterToggle<T extends SelectedFile>(
	files: readonly T[],
	selected: SelectedFile,
): T | null {
	const section = files.filter((file) => file.staged === selected.staged);
	const index = section.findIndex((file) => file.path === selected.path);
	const current = section[index];
	return current
		? (section[index + 1] ??
				section[index - 1] ?? { ...current, staged: !current.staged })
		: null;
}

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
	commitDetails: CommitDetails | null;
	commitDetailsError?: string | null;
	comparisonDetailsLoading?: boolean;
	comparisonDetails?: ComparisonDetails | null;
	onSelectCommitFile?: (file: CommitFile) => void;
	onSelectComparisonFile?: (file: CommitFile) => void;
	branch?: string;
	commitMessage: string;
	onCommitMessageChange: (msg: string) => void;
	onCommit: () => void;
	isCommitting: boolean;
	amendMode: boolean;
	onAmendModeChange: (v: boolean) => void;
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
	const unstagedFiles = useMemo(
		() =>
			visibleGitFiles([...modified, ...untracked], filePresentation, "path"),
		[modified, untracked, filePresentation],
	);
	const stagedFiles = useMemo(
		() => visibleGitFiles(staged, filePresentation, "path"),
		[staged, filePresentation],
	);
	const workingFiles = useMemo(
		() => [...unstagedFiles, ...stagedFiles],
		[stagedFiles, unstagedFiles],
	);
	const navigableFiles = useMemo(
		() =>
			fileViewMode === "tree"
				? [
						...visibleGitFiles(unstagedFiles, filePresentation, "tree"),
						...visibleGitFiles(stagedFiles, filePresentation, "tree"),
					]
				: workingFiles,
		[fileViewMode, stagedFiles, unstagedFiles, workingFiles, filePresentation],
	);
	const showingWorkingTree = content === "workingTree";
	const historicalFiles =
		comparisonDetails?.files ?? commitDetails?.files ?? [];
	const historicalPresentation =
		comparisonDetails?.filePresentation ?? commitDetails?.filePresentation;
	const navigableHistoricalFiles = useMemo(
		() =>
			visibleGitFiles(historicalFiles, historicalPresentation, fileViewMode),
		[fileViewMode, historicalFiles, historicalPresentation],
	);
	const displayedFiles = showingWorkingTree ? workingFiles : historicalFiles;
	const additions = displayedFiles.reduce(
		(total, file) => total + (file.additions ?? 0),
		0,
	);
	const deletions = displayedFiles.reduce(
		(total, file) => total + (file.deletions ?? 0),
		0,
	);
	const selectAdjacentFile = (direction: -1 | 1) => {
		if (!showingWorkingTree) {
			if (navigableHistoricalFiles.length === 0) return;
			const currentIndex = selectedFile
				? navigableHistoricalFiles.findIndex(
						(file) => file.path === selectedFile.path,
					)
				: -1;
			const nextIndex =
				currentIndex < 0
					? direction > 0
						? 0
						: navigableHistoricalFiles.length - 1
					: Math.max(
							0,
							Math.min(
								navigableHistoricalFiles.length - 1,
								currentIndex + direction,
							),
						);
			const nextFile = navigableHistoricalFiles[nextIndex]!;
			if (selectedCommitCount > 1) onSelectComparisonFile?.(nextFile);
			else onSelectCommitFile?.(nextFile);
			return;
		}
		if (navigableFiles.length === 0) return;
		const currentIndex = selectedFile
			? navigableFiles.findIndex(
					(file) =>
						file.path === selectedFile.path &&
						file.staged === selectedFile.staged,
				)
			: -1;
		const nextIndex =
			currentIndex < 0
				? direction > 0
					? 0
					: navigableFiles.length - 1
				: Math.max(
						0,
						Math.min(navigableFiles.length - 1, currentIndex + direction),
					);
		onSelectFile(navigableFiles[nextIndex]!);
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
				<div {...stylex.props(styles.splitArea)}>
					{!hasProject ? (
						<div {...stylex.props(styles.emptyState)}>
							{projectLoading ? (
								<div {...stylex.props(styles.loadingState)}>
									<DotMatrixWeave ariaLabel="Checking repository" />
									<span>Checking repository…</span>
								</div>
							) : (
								<p {...stylex.props(styles.emptyText, styles.centerText)}>
									No Git repository
								</p>
							)}
						</div>
					) : (
						<>
							<FileGroup
								title="Unstaged"
								filePresentation={filePresentation}
								files={unstagedFiles}
								selected={selectedFile}
								onSelect={onSelectFile}
								actionLabel={showFileActions ? "Stage" : undefined}
								onAction={showFileActions ? onStageFile : undefined}
								onActionAll={showFileActions ? onStageAll : undefined}
								viewMode={fileViewMode}
								splitPane
							/>
							<FileGroup
								title="Staged"
								filePresentation={filePresentation}
								files={stagedFiles}
								selected={selectedFile}
								onSelect={onSelectFile}
								actionLabel={showFileActions ? "Unstage" : undefined}
								onAction={showFileActions ? onUnstageFile : undefined}
								onActionAll={showFileActions ? onUnstageAll : undefined}
								viewMode={fileViewMode}
								splitPane
							/>
						</>
					)}
				</div>
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
				<div {...stylex.props(styles.splitArea)}>
					{selectedCommitCount > 1 ? (
						comparisonDetailsLoading ? (
							<div {...stylex.props(styles.emptyStateLarge)}>
								<p {...stylex.props(styles.mutedText)}>Comparing…</p>
							</div>
						) : comparisonDetails ? (
							<ComparisonDetailsPanel
								details={comparisonDetails}
								selectionCount={selectedCommitCount}
								selectedFile={selectedFile}
								onSelectFile={onSelectComparisonFile}
								viewMode={fileViewMode}
							/>
						) : (
							<div {...stylex.props(styles.emptyStateLarge)}>
								<p {...stylex.props(styles.mutedText, styles.centerText)}>
									The selected items cannot be compared
								</p>
							</div>
						)
					) : selectedCommitHash ? (
						commitDetailsLoading ? (
							<div {...stylex.props(styles.emptyStateLarge)}>
								<p {...stylex.props(styles.mutedText)}>Loading…</p>
							</div>
						) : commitDetails ? (
							<CommitDetailsPanel
								details={commitDetails}
								selectedFile={selectedFile}
								onSelectFile={onSelectCommitFile}
								viewMode={fileViewMode}
							/>
						) : (
							<div {...stylex.props(styles.emptyStateLarge)}>
								<p {...stylex.props(styles.mutedText, styles.centerText)}>
									{commitDetailsError || "No details available for this commit"}
								</p>
							</div>
						)
					) : (
						<div {...stylex.props(styles.emptyStateLarge)}>
							<p {...stylex.props(styles.mutedText, styles.centerText)}>
								Select a commit to view details
							</p>
						</div>
					)}
				</div>
			)}
		</div>
	);
});

export type { SelectedFile } from "../../../model/workbench-model.ts";
export { visibleGitFiles } from "../../../model/workbench-model.ts";
export { CollapsedChangesPanel } from "./CollapsedChangesPanel.tsx";
