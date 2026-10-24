import type {
	ChangesPanelProjection,
	GitCommitDetails,
	GitCommitFile,
	GitComparisonDetails,
	GitFileEntry,
	GitFilePresentation,
	SelectedPanelFile,
} from "@contracts";
import { iconSize, selectionAppearance } from "@design-system/styles.stylex.ts";
import type { useGitChangeActions } from "@repository/hooks/useGitStatus.tsx";
import { ariaValue } from "@shared/lib/dom.tsx";
import { project as rustProject } from "@shared/lib/native.tsx";
import { DotMatrixLoader } from "@shared/ui/DotMatrixLoader/index.tsx";
import {
	IconExternalLink,
	IconGitBranch,
	IconLayoutRows,
} from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, For, Show } from "solid-js";
import { CommitSection } from "./CommitSection.tsx";
import { DetailIdentity } from "./DetailIdentity.tsx";
import { FileChangeTotals } from "./FileChangeTotals.tsx";
import { FileGroup } from "./FileGroup.tsx";
import { styles } from "./styles.ts";

export type SelectedFile = Pick<SelectedPanelFile, "path" | "staged">;

export type ChangesPanelModel = Omit<
	ChangesPanelProjection,
	| "unstagedFiles"
	| "stagedFiles"
	| "navigableFiles"
	| "historyDetails"
	| "navigableHistoricalFiles"
> & {
	unstagedFiles: GitFileEntry[];
	stagedFiles: GitFileEntry[];
	navigableFiles: GitFileEntry[];
	historyDetails: GitCommitDetails | GitComparisonDetails | null;
	navigableHistoricalFiles: GitCommitFile[];
};

export const ChangesPanel = function ChangesPanel(props: {
	actions: ReturnType<typeof useGitChangeActions>;
	onPrefetchFiles?: (files: GitFileEntry[]) => void;
	filePresentation?: GitFilePresentation;
	cwd?: string;
	fileViewMode: "path" | "tree";
	onFileViewModeChange: (mode: "path" | "tree") => void;
	model: ChangesPanelModel;
	selectedFile: SelectedFile | null;
	onSelectFile: (f: GitFileEntry) => void;
	hasProject: boolean;
	projectLoading?: boolean;
	selectedCommitCount?: number;
	selectedWorktreePath?: string;
	onOpenWorktree?: () => void;
	onSelectCommitFile?: (file: GitCommitFile) => void;
	onSelectComparisonFile?: (file: GitCommitFile) => void;
	showFileActions?: boolean;
	showCommitSection?: boolean;
}) {
	const showCommitSection = () =>
		props.hasProject &&
		props.model.showingWorkingTree &&
		props.showCommitSection !== false;
	const prefetchFiles = createMemo(() => {
		if (!props.model.showingWorkingTree) return [];
		const files = props.model.navigableFiles;
		return rustProject<number[]>("diffPrefetchFiles", {
			count: files.length,
			current: files.findIndex(
				(file) =>
					file.path === props.selectedFile?.path &&
					file.staged === props.selectedFile?.staged,
			),
		}).map((index) => files[index]!);
	});

	createEffect(
		() => [prefetchFiles(), props.onPrefetchFiles] as const,
		([files, prefetch]) => prefetch?.(files),
	);

	return (
		<div
			{...stylex.attrs(
				styles.root,
				props.model.showingWorkingTree && styles.workingTree,
				showCommitSection() && styles.withCommit,
			)}
		>
			<div {...stylex.attrs(styles.sidebarHeader)}>
				{props.hasProject && (
					<div {...stylex.attrs(styles.segmented)}>
						<For each={["path", "tree"] as const}>
							{(mode) => (
								<button
									type="button"
									onClick={() => props.onFileViewModeChange(mode)}
									aria-pressed={ariaValue(props.fileViewMode === mode)}
									{...stylex.attrs(
										styles.segmentButton,
										...selectionAppearance("view", props.fileViewMode === mode),
									)}
								>
									{mode === "path" ? (
										<IconLayoutRows size={iconSize.sm} />
									) : (
										<IconGitBranch size={iconSize.sm} />
									)}
									{mode === "path" ? "Path" : "Tree"}
								</button>
							)}
						</For>
					</div>
				)}
				<span {...stylex.attrs(styles.spacer)} />
				{props.hasProject && (
					<FileChangeTotals
						additions={props.model.additions}
						deletions={props.model.deletions}
					/>
				)}
				{props.onOpenWorktree && (
					<button
						type="button"
						onClick={props.onOpenWorktree}
						title={`Open linked worktree ${props.selectedWorktreePath ?? ""}`.trim()}
						aria-label="Open linked worktree"
						{...stylex.attrs(styles.headerIconButton)}
					>
						<IconExternalLink size={iconSize.compact} />
					</button>
				)}
			</div>

			{props.model.showingWorkingTree && (
				<div {...stylex.attrs(styles.splitArea, styles.workingFiles)}>
					{!props.hasProject ? (
						<div {...stylex.attrs(styles.emptyState)}>
							{props.projectLoading ? (
								<div {...stylex.attrs(styles.loadingState)}>
									<DotMatrixLoader
										variant="weave"
										ariaLabel="Checking repository"
									/>
									<span>Checking repository…</span>
								</div>
							) : (
								<p {...stylex.attrs(styles.emptyText, styles.centerText)}>
									No Git repository
								</p>
							)}
						</div>
					) : (
						<For each={[false, true]}>
							{(staged) => (
								<FileGroup
									title={staged ? "Staged" : "Unstaged"}
									files={
										staged ? props.model.stagedFiles : props.model.unstagedFiles
									}
									filePresentation={props.filePresentation}
									selected={props.selectedFile}
									onSelect={props.onSelectFile}
									onPrefetchFile={(file) =>
										props.onPrefetchFiles?.(
											file ? [file, ...prefetchFiles()] : prefetchFiles(),
										)
									}
									{...(props.showFileActions
										? {
												actionLabel: staged ? "Unstage" : "Stage",
												onAction: staged
													? props.actions.unstageFile
													: props.actions.stageFile,
												onActionAll: staged
													? props.actions.unstageAll
													: props.actions.stageAll,
												onStash: props.actions.stashFile,
												onDiscard: (path: string) =>
													props.actions.discard(staged, path),
												onDiscardAll: () => props.actions.discard(staged),
											}
										: {})}
									viewMode={props.fileViewMode}
									splitPane
								/>
							)}
						</For>
					)}
				</div>
			)}

			{showCommitSection() && (
				<CommitSection
					cwd={props.cwd}
					actions={props.actions}
					stagedCount={props.model.stagedFiles.length}
				/>
			)}

			{!props.model.showingWorkingTree && (
				<div {...stylex.attrs(styles.splitArea)}>
					<Show
						when={props.model.historyDetails}
						fallback={
							<div {...stylex.attrs(styles.emptyStateLarge)}>
								<p
									{...stylex.attrs(
										styles.mutedText,
										!props.model.historyLoading && styles.centerText,
									)}
								>
									{props.model.historyMessage}
								</p>
							</div>
						}
					>
						{(details) => {
							const comparison = () => "fromHash" in details();
							return (
								<div {...stylex.attrs(styles.detailsRoot)}>
									<div
										data-comparison-details-summary={
											comparison() ? "true" : undefined
										}
										data-commit-details-summary={
											comparison() ? undefined : "true"
										}
										{...stylex.attrs(styles.detailsHeader)}
									>
										{(() => {
											const _details = details();
											return "fromHash" in _details ? (
												<>
													<span {...stylex.attrs(styles.detailIdentityLabel)}>
														Comparing{" "}
														{props.model.comparing
															? props.selectedCommitCount
															: undefined}{" "}
														items
													</span>
													<div {...stylex.attrs(styles.comparisonRange)}>
														<code title={_details.fromHash}>
															{_details.fromHash.slice(0, 7)}
														</code>
														<span aria-hidden="true">→</span>
														<code title={_details.toHash}>
															{_details.toHash === "WORKTREE"
																? "WIP"
																: _details.toHash.slice(0, 7)}
														</code>
													</div>
													{_details.mergeBase ? (
														<span
															{...stylex.attrs(styles.mutedTextSmall)}
															title={_details.mergeBase}
														>
															Merge base {_details.mergeBase.slice(0, 7)}
														</span>
													) : null}
												</>
											) : (
												<>
													<p
														title={_details.message}
														{...stylex.attrs(styles.commitMessage)}
													>
														{_details.message}
													</p>
													{_details.body ? (
														<div
															{...stylex.attrs(
																styles.commitDescriptionViewport,
															)}
															style={{
																"max-height": "8.4em",
																overflow: "auto",
															}}
														>
															<p
																title={_details.body}
																{...stylex.attrs(styles.commitDescription)}
															>
																{_details.body}
															</p>
														</div>
													) : null}
													<div {...stylex.attrs(styles.detailIdentityGrid)}>
														<DetailIdentity
															cwd={props.cwd}
															hash={_details.hash}
															name={_details.author}
															email={_details.authorEmail}
															date={_details.authoredAt}
														/>
													</div>
												</>
											);
										})()}
									</div>
									<div {...stylex.attrs(styles.scrollArea)}>
										{!comparison() || details().files.length ? (
											<FileGroup
												title="Changed"
												files={props.model.navigableHistoricalFiles}
												isCollapsible={false}
												showHeader={false}
												filePresentation={details().filePresentation}
												selected={props.selectedFile}
												viewMode={props.fileViewMode}
												onSelect={(file) =>
													(props.model.comparing
														? props.onSelectComparisonFile
														: props.onSelectCommitFile)?.(file)
												}
											/>
										) : (
											<div {...stylex.attrs(styles.emptyStateLarge)}>
												<p {...stylex.attrs(styles.mutedText)}>
													No file differences
												</p>
											</div>
										)}
									</div>
								</div>
							);
						}}
					</Show>
				</div>
			)}
		</div>
	);
};
