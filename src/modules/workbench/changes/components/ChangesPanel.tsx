import * as stylex from "@octanejs/stylex";
import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "octane";
import { postJson } from "../../../../adapters/backend/http.ts";
import { iconSize, runtimeColor } from "../../../../design-system.ts";
import type {
	CommitDetails,
	CommitFile,
	ComparisonDetails,
} from "../../../../modules/repository/hooks/useGitGraph.tsx";
import { resolveGitAuthorAvatar } from "../../../../modules/repository/model/git-avatar.ts";
import type { GitFileEntry } from "../../../../modules/repository/model/types.ts";
import { DotMatrixWeave } from "../../../../shared/ui/DotMatrixLoader.tsx";
import { Liquid } from "../../../../shared/ui/gooey/index.ts";
import { LiquidSegmentedRail } from "../../../../shared/ui/gooey/LiquidSegmentedRail.tsx";
import {
	IconChevronRight,
	IconExternalLink,
	IconFolderFill,
	IconGitCommit,
	IconMinus,
	IconPanelLeft,
	IconPencil,
	IconPlus,
	IconSparkles,
} from "../../../../shared/ui/Icons.tsx";
import {
	color,
	controlSize,
	font,
	layer,
	motion,
	radius,
	shadow,
} from "../../../../tokens.stylex.ts";
import { FileTypeIcon } from "../../../explorer/components/FileTypeIcon.tsx";
import {
	buildFileTree,
	type FileTreeNode,
	getAlphabeticalFileOrder,
	getExpandedFileDirectories,
	getFileSelectionAfterToggle,
	getTreeFileOrder,
	sortFileTreeChildren,
} from "../model/changes-model.ts";

export interface SelectedFile {
	path: string;
	staged: boolean;
}

interface ChangesPanelProps {
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

/* ── Main reusable changes sidebar component ──────────── */

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
	const unstagedFiles = useMemo(
		() => getAlphabeticalFileOrder([...modified, ...untracked]),
		[modified, untracked],
	);
	const stagedFiles = useMemo(() => getAlphabeticalFileOrder(staged), [staged]);
	const workingFiles = useMemo(
		() => [...unstagedFiles, ...stagedFiles],
		[stagedFiles, unstagedFiles],
	);
	const navigableFiles = useMemo(
		() =>
			fileViewMode === "tree"
				? [...getTreeFileOrder(unstagedFiles), ...getTreeFileOrder(stagedFiles)]
				: workingFiles,
		[fileViewMode, stagedFiles, unstagedFiles, workingFiles],
	);
	const showingWorkingTree = content === "workingTree";
	const historicalFiles =
		comparisonDetails?.files ?? commitDetails?.files ?? [];
	const navigableHistoricalFiles = useMemo(
		() =>
			fileViewMode === "tree"
				? getTreeFileOrder(historicalFiles)
				: getAlphabeticalFileOrder(historicalFiles),
		[fileViewMode, historicalFiles],
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
				<div {...stylex.props(styles.scrollArea)}>
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

export const CollapsedChangesPanel = memo(function CollapsedChangesPanel({
	stagedCount,
	unstagedCount,
	onExpand,
	onOpenGraph,
	graphActive = false,
}: {
	stagedCount: number;
	unstagedCount: number;
	onExpand: () => void;
	onOpenGraph?: () => void;
	graphActive?: boolean;
}) {
	return (
		<div {...stylex.props(styles.collapsedRoot)}>
			<button
				type="button"
				onPointerDown={(event) => {
					if (event.button === 0 && event.isPrimary) onExpand();
				}}
				onClick={(event) => {
					if (event.detail === 0) onExpand();
				}}
				title="Expand files sidebar"
				aria-label="Expand files sidebar"
				{...stylex.props(styles.collapsedToggle)}
			>
				<IconPanelLeft size={iconSize._2md} />
			</button>
			{onOpenGraph ? (
				<button
					type="button"
					onClick={onOpenGraph}
					title="Repository graph"
					aria-label="Repository graph"
					{...stylex.props(
						styles.collapsedGraphButton,
						graphActive && styles.headerIconButtonActive,
					)}
				>
					<IconGitCommit size={iconSize.md} />
				</button>
			) : null}
			<div {...stylex.props(styles.collapsedCounts)}>
				<div
					{...stylex.props(styles.collapsedCount)}
					title={`${unstagedCount} unstaged ${unstagedCount === 1 ? "file" : "files"}`}
				>
					<span {...stylex.props(styles.unstagedDot)} />
					<span>{unstagedCount}</span>
				</div>
				<div
					{...stylex.props(styles.collapsedCount)}
					title={`${stagedCount} staged ${stagedCount === 1 ? "file" : "files"}`}
				>
					<span {...stylex.props(styles.stagedDot)} />
					<span>{stagedCount}</span>
				</div>
			</div>
		</div>
	);
});

const styles = stylex.create({
	root: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		minWidth: controlSize._0,
		backgroundColor: color.transparent,
	},
	collapsedRoot: {
		display: "flex",
		width: 37,
		height: "100%",
		alignItems: "center",
		flexDirection: "column",
		backgroundColor: color.transparent,
	},
	collapsedToggle: {
		display: "flex",
		width: "100%",
		height: controlSize._8,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
	},
	collapsedCounts: {
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		gap: controlSize._3,
		paddingTop: controlSize._3,
	},
	collapsedGraphButton: {
		display: "flex",
		width: controlSize._6,
		height: controlSize._6,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		marginTop: controlSize._2,
		borderRadius: radius.md,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
	},
	collapsedCount: {
		display: "flex",
		minWidth: controlSize._6,
		alignItems: "center",
		justifyContent: "center",
		gap: controlSize._1,
		color: color.textSoft,
		fontFamily: font.familyDiff,
		fontSize: font.size_1,
		fontVariantNumeric: "tabular-nums",
	},
	unstagedDot: {
		width: controlSize._1_25,
		height: controlSize._1_25,
		borderRadius: radius.pill,
		backgroundColor: color.warning,
	},
	stagedDot: {
		width: controlSize._1_25,
		height: controlSize._1_25,
		borderRadius: radius.pill,
		backgroundColor: color.gitAdded,
	},
	scrollArea: {
		flex: 1,
		minHeight: controlSize._0,
		overflowY: "auto",
	},
	splitArea: {
		display: "flex",
		flex: 1,
		minHeight: controlSize._0,
		flexDirection: "column",
		overflow: "hidden",
	},
	emptyState: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		paddingBlock: controlSize._6,
	},
	loadingState: {
		alignItems: "center",
		color: color.textMuted,
		display: "flex",
		fontSize: font.size_2,
		gap: controlSize._2,
	},
	emptyStateLarge: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		paddingBlock: controlSize._8,
	},
	emptyText: {
		color: color.surfaceWhite25,
		fontSize: font.size_2,
	},
	centerText: {
		paddingInline: controlSize._3,
		textAlign: "center",
	},
	mutedText: {
		color: color.textMuted,
		fontSize: font.size_2,
	},
	mutedTextSmall: {
		color: color.textMuted,
		fontSize: font.size_1,
	},
	sidebarHeader: {
		position: "sticky",
		top: controlSize._0,
		zIndex: layer.dropdown,
		display: "flex",
		height: controlSize._8,
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._2,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.background,
		paddingInline: controlSize._3,
		paddingBlock: controlSize._0,
	},
	changeTotals: {
		display: "flex",
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._1_5,
		fontFamily: font.familyDiff,
		fontSize: font.size_1,
		fontVariantNumeric: "tabular-nums",
	},
	spacer: {
		flex: 1,
	},
	segmented: {
		position: "relative",
		isolation: "isolate",
		display: "flex",
		height: controlSize._5,
		alignItems: "center",
		backgroundColor: color.transparent,
	},
	segmentButton: {
		position: "relative",
		zIndex: layer.content,
		height: "100%",
		paddingInline: controlSize._2,
		color: color.textMuted,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		borderRadius: radius.md,
		transitionProperty: "color",
		transitionDuration: motion.durationFast,
		backgroundColor: color.transparent,
	},
	segmentButtonActive: {
		backgroundColor: color.transparent,
		color: color.textMain,
	},
	headerIconButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		borderColor: color.transparent,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		display: "inline-flex",
		height: controlSize._5,
		justifyContent: "center",
		width: controlSize._5,
		transitionProperty: "background-color, border-color, color",
		transitionDuration: motion.durationFast,
	},
	headerIconButtonActive: {
		backgroundColor: color.controlActive,
		borderColor: color.borderStrong,
		color: color.textMain,
	},
	commitSection: {
		display: "flex",
		flexShrink: 0,
		flexDirection: "column",
		backgroundColor: color.transparent,
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: color.border,
		boxShadow: "0 -10px 24px rgba(0, 0, 0, 0.16)",
	},
	sectionTitle: {
		color: color.textMain,
		fontSize: font.size_2_75,
		fontWeight: font.weight_5,
	},
	fileGroupTitle: {
		color: color.textSoft,
		fontSize: font.size_2,
	},
	commitForm: {
		display: "flex",
		order: 2,
		flexDirection: "column",
		gap: controlSize._1_5,
		paddingInline: controlSize._2,
		paddingBlock: controlSize._2,
	},
	commitEditor: {
		height: controlSize._7,
		backgroundColor: color.backgroundRaised,
		borderColor: {
			default: color.border,
			":focus-within": color.borderStrong,
		},
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: {
			default: shadow.composerFrame,
			":focus-within": shadow.composerFrameFocus,
		},
		overflow: "hidden",
		transitionDuration: motion.durationBase,
		transitionProperty: "border-color, box-shadow, background-color",
	},
	commitEditorLiquid: {
		backgroundColor: color.transparent,
		borderColor: color.transparent,
		borderRadius: radius.md,
		boxShadow: "none",
	},
	summaryRow: {
		display: "flex",
		height: "100%",
		alignItems: "center",
	},
	summaryInput: {
		minWidth: controlSize._0,
		height: "100%",
		flex: 1,
		backgroundColor: color.transparent,
		color: color.textMain,
		fontSize: font.size_3,
		fontWeight: font.weight_5,
		outline: "none",
		paddingBlock: controlSize._0,
		paddingInline: controlSize._3,
		"::placeholder": {
			color: color.textFaint,
		},
	},
	generateMessageButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceWhite06,
		},
		borderRadius: radius.md,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		display: "flex",
		flexShrink: 0,
		height: controlSize._6,
		justifyContent: "center",
		marginRight: controlSize._2,
		width: controlSize._6,
		":disabled": {
			opacity: 0.45,
		},
	},
	commitButtonSurface: {
		display: "flex",
		width: "100%",
		height: controlSize._7,
		overflow: "hidden",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.textWarmWhite,
		borderRadius: radius.md,
		backgroundColor: color.textWarmWhite,
		boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, 0.12)",
	},
	commitMainAction: {
		display: "flex",
		minWidth: controlSize._0,
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		gap: controlSize._1_5,
		backgroundColor: {
			default: color.transparent,
			":hover": "rgba(0, 0, 0, 0.06)",
		},
		color: color.textWarmInk,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		":disabled": {
			color: color.textWarmInk,
			opacity: 1,
			WebkitTextFillColor: "#111210",
		},
	},
	detailsRoot: {
		display: "flex",
		height: "100%",
		flexDirection: "column",
	},
	detailsHeader: {
		flexShrink: 0,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: color.border,
		padding: controlSize._3,
	},
	detailIdentityGrid: {
		display: "grid",
		gridTemplateColumns: "minmax(0, 1fr)",
		gap: controlSize._3,
	},
	detailIdentity: {
		display: "flex",
		minWidth: controlSize._0,
		alignItems: "center",
		gap: controlSize._2,
	},
	detailIdentityCopy: {
		display: "flex",
		minWidth: controlSize._0,
		flexDirection: "column",
	},
	detailAvatar: {
		display: "flex",
		width: controlSize._8,
		height: controlSize._8,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		overflow: "hidden",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.borderStrong,
		borderRadius: radius.pill,
		backgroundColor: color.surfaceControl,
		color: color.textSoft,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
	},
	detailAvatarImage: {
		display: "block",
		width: "100%",
		height: "100%",
		objectFit: "cover",
	},
	comparisonRange: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
		color: color.textMain,
		fontFamily: font.familyMono,
		fontSize: font.size_2_75,
	},
	detailIdentityLabel: {
		display: "block",
		marginBottom: controlSize._1,
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		letterSpacing: "0.08em",
		textTransform: "uppercase",
	},
	commitMessage: {
		color: color.textMain,
		display: "-webkit-box",
		fontSize: font.size_4,
		fontWeight: font.weight_5,
		lineHeight: 1.4,
		overflow: "hidden",
		WebkitBoxOrient: "vertical",
		WebkitLineClamp: 2,
	},
	commitDescriptionViewport: {
		flexShrink: 1,
		lineHeight: 1.4,
		minHeight: controlSize._0,
		maxHeight: "8.4em",
		outline: "none",
		overflow: "auto",
	},
	commitDescription: {
		color: color.textMain,
		cursor: "text",
		fontSize: font.size_2,
		whiteSpace: "pre-wrap",
	},
	authorText: {
		color: color.textSoft,
		fontSize: font.size_2,
	},
	fileStats: {
		flexShrink: 0,
		display: "flex",
		alignItems: "center",
		gap: controlSize._1,
		fontSize: font.size_1,
		fontVariantNumeric: "tabular-nums",
	},
	addedText: {
		color: color.diffAdded,
	},
	deletedText: {
		color: color.diffRemoved,
	},
	statusIcon: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		fontSize: font.size_0,
		fontWeight: font.weightBold,
		lineHeight: 1,
		filter: "drop-shadow(0 1px 1px rgba(0, 0, 0, 0.95))",
	},
	fileChangeIcon: {
		position: "relative",
		display: "inline-flex",
		width: 17,
		height: 17,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
	},
	fileChangeMark: {
		position: "absolute",
		right: -2,
		top: -2,
		width: controlSize._2,
		height: controlSize._2,
		pointerEvents: "none",
	},
	modified: {
		color: color.diffModified,
	},
	addedStatus: {
		color: color.diffAdded,
	},
	deletedStatus: {
		color: color.diffRemoved,
	},
	renamedStatus: {
		color: color.diffRenamed,
	},
	defaultStatus: {
		color: color.textSoft,
	},
	fileGroup: {
		display: "flex",
		flexShrink: 0,
		flexDirection: "column",
	},
	splitFileGroup: {
		boxSizing: "border-box",
		flexGrow: 0,
		flexShrink: 0,
		height: "50%",
		minHeight: "50%",
		maxHeight: "50%",
		overflow: "hidden",
	},
	emptyGroupBody: {
		height: controlSize._12,
		flexShrink: 0,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
	},
	emptyGroupText: {
		color: color.textFaint,
		fontSize: font.size_2,
	},
	groupHeader: {
		display: "flex",
		height: controlSize._8,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "space-between",
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.transparent,
		paddingInline: controlSize._3,
		gap: controlSize._2,
	},
	groupHeaderSeparated: {
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: color.border,
	},
	groupToggle: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
		backgroundColor: color.transparent,
	},
	cursorPointer: {
		cursor: "pointer",
	},
	cursorDefault: {
		cursor: "default",
	},
	chevron: {
		flexShrink: 0,
		color: color.textMuted,
		transitionProperty: "transform",
		transitionDuration: motion.durationFast,
	},
	chevronOpen: {
		transform: "rotate(90deg)",
	},
	countPill: {
		display: "flex",
		minWidth: controlSize._5,
		height: controlSize._4,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: radius.pill,
		backgroundColor: color.surfaceControl,
		color: color.textMain,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		fontVariantNumeric: "tabular-nums",
		paddingInline: controlSize._1_5,
	},
	actionAllButton: {
		display: "flex",
		height: controlSize._6,
		width: controlSize._6,
		alignItems: "center",
		justifyContent: "center",
		padding: controlSize._0,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		backgroundColor: color.transparent,
	},
	groupList: {
		flexShrink: 0,
		backgroundColor: color.transparent,
	},
	splitGroupList: {
		flexGrow: 1,
		flexShrink: 1,
		minHeight: controlSize._0,
		overflowY: "auto",
		overscrollBehavior: "contain",
	},
	pathRow: {
		position: "relative",
		display: "flex",
		contentVisibility: "auto",
		containIntrinsicSize: `auto ${controlSize._6}`,
		alignItems: "center",
		gap: controlSize._2,
		borderLeftWidth: 2,
		borderLeftStyle: "solid",
		borderLeftColor: color.transparent,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._3,
		transitionProperty: "background-color, border-color",
		transitionDuration: motion.durationFast,
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceSubtle,
		},
	},
	treeRow: {
		position: "relative",
		display: "flex",
		contentVisibility: "auto",
		containIntrinsicSize: `auto ${controlSize._5}`,
		height: controlSize._5,
		cursor: "pointer",
		alignItems: "center",
		gap: controlSize._1,
		borderLeftWidth: 2,
		borderLeftStyle: "solid",
		borderLeftColor: color.transparent,
		transitionProperty: "background-color, border-color",
		transitionDuration: motion.durationFast,
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceSubtle,
		},
	},
	treeNodeButton: {
		alignItems: "center",
		backgroundColor: color.transparent,
		cursor: "pointer",
		display: "flex",
		flex: 1,
		gap: controlSize._1,
		height: "100%",
		minWidth: controlSize._0,
		padding: controlSize._0,
		textAlign: "left",
	},
	fileRowActive: {
		borderLeftColor: color.borderStrong,
		backgroundColor: color.surfaceInset,
	},
	fileButton: {
		minWidth: controlSize._0,
		flex: 1,
		display: "flex",
		flexDirection: "column",
		textAlign: "left",
		backgroundColor: color.transparent,
	},
	fileRowButton: {
		display: "flex",
		minWidth: controlSize._0,
		flex: 1,
		alignItems: "center",
		gap: controlSize._2,
		backgroundColor: color.transparent,
		textAlign: "left",
	},
	pathFileName: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		lineHeight: 1.3,
		transitionProperty: "color",
		transitionDuration: motion.durationFast,
	},
	activeText: {
		color: color.textMain,
	},
	rowAction: {
		position: "absolute",
		right: controlSize._2,
		top: "50%",
		zIndex: layer.control,
		transform: "translateY(-50%)",
		display: "flex",
		width: "1.125rem",
		height: "1.125rem",
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.circle,
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		opacity: 0,
		pointerEvents: "none",
		transitionProperty: "opacity, color, background-color, border-color",
		transitionDuration: motion.durationFast,
	},
	rowActionVisible: {
		opacity: 1,
		pointerEvents: "auto",
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
	},
	rowActionSubtle: {
		position: "absolute",
		right: controlSize._2,
		top: "50%",
		zIndex: layer.control,
		transform: "translateY(-50%)",
		display: "flex",
		width: "1.125rem",
		height: "1.125rem",
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.circle,
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		opacity: 0,
		pointerEvents: "none",
		transitionProperty: "opacity, color, background-color, border-color",
		transitionDuration: motion.durationFast,
	},
	folderIcon: {
		flexShrink: 0,
		color: color.textMuted,
		transitionProperty: "color",
		transitionDuration: motion.durationFast,
	},
	folderIconOpen: {
		color: color.textSoft,
	},
	treeName: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textSoft,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
	},
	treeIndentSpacer: {
		width: controlSize._2,
		flexShrink: 0,
	},
	treeFileName: {
		minWidth: controlSize._0,
		flex: 1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		transitionProperty: "color",
		transitionDuration: motion.durationFast,
	},
});

/* ── Sub-components ───────────────────────────────────── */

function FileActionIcon({
	actionLabel,
	size = 11,
}: {
	actionLabel?: string;
	size?: number;
}) {
	return actionLabel === "Unstage" ? (
		<IconMinus size={size} />
	) : (
		<IconPlus size={size} />
	);
}

function ChangesPanelHeader({
	onCollapse,
	onOpenGraph,
	graphActive,
	additions,
	deletions,
	fileViewMode,
	onFileViewModeChange,
	showFileControls,
	worktreePath,
	onOpenWorktree,
}: {
	onCollapse?: () => void;
	onOpenGraph?: () => void;
	graphActive: boolean;
	additions: number;
	deletions: number;
	fileViewMode: "path" | "tree";
	onFileViewModeChange: (mode: "path" | "tree") => void;
	showFileControls: boolean;
	worktreePath?: string;
	onOpenWorktree?: () => void;
}) {
	return (
		<div {...stylex.props(styles.sidebarHeader)}>
			{onCollapse ? (
				<button
					type="button"
					onPointerDown={(event) => {
						if (event.button === 0 && event.isPrimary) onCollapse();
					}}
					onClick={(event) => {
						if (event.detail === 0) onCollapse();
					}}
					title="Collapse files sidebar"
					aria-label="Collapse files sidebar"
					{...stylex.props(styles.headerIconButton)}
				>
					<IconPanelLeft size={iconSize.md} />
				</button>
			) : null}
			{onOpenGraph ? (
				<button
					type="button"
					onClick={onOpenGraph}
					title="Repository graph"
					aria-label="Repository graph"
					{...stylex.props(
						styles.headerIconButton,
						graphActive && styles.headerIconButtonActive,
					)}
				>
					<IconGitCommit size={iconSize.compact} />
				</button>
			) : null}
			<span {...stylex.props(styles.spacer)} />
			{showFileControls ? (
				<>
					<FileChangeTotals additions={additions} deletions={deletions} />
					<FileViewToggle
						value={fileViewMode}
						onChange={onFileViewModeChange}
					/>
				</>
			) : null}
			{onOpenWorktree ? (
				<button
					type="button"
					onClick={onOpenWorktree}
					title={`Open linked worktree ${worktreePath ?? ""}`.trim()}
					aria-label="Open linked worktree"
					{...stylex.props(styles.headerIconButton)}
				>
					<IconExternalLink size={iconSize.compact} />
				</button>
			) : null}
		</div>
	);
}

function CommitSection({
	cwd,
	commitMessage,
	onCommitMessageChange,
	onCommit,
	isCommitting,
	stagedCount,
}: {
	cwd?: string;
	commitMessage: string;
	onCommitMessageChange: (msg: string) => void;
	onCommit: () => void;
	isCommitting: boolean;
	stagedCount: number;
}) {
	const [generating, setGenerating] = useState(false);
	const message = commitMessage.replace(/\s+/g, " ");
	const generateMessage = async () => {
		if (!cwd || !stagedCount || generating) return;
		setGenerating(true);
		try {
			const data = await postJson<{ message?: string }>(
				"/api/git/generate-commit-message",
				{ cwd },
			);
			if (data.message) {
				onCommitMessageChange(data.message.replace(/\s+/g, " ").trim());
			}
		} catch {
			// ignore
		} finally {
			setGenerating(false);
		}
	};

	return (
		<div {...stylex.props(styles.commitSection)}>
			<div {...stylex.props(styles.commitForm)}>
				<Liquid
					blur={5}
					contrast={20}
					fill={runtimeColor.backgroundRaised}
					filterPadding={18}
					shadow="inset 0 1px 0 rgba(255,255,255,.08), 0 8px 24px rgba(0,0,0,.2)"
				>
					<Liquid.Item observe radius={6}>
						<div
							{...stylex.props(styles.commitEditor, styles.commitEditorLiquid)}
						>
							<div {...stylex.props(styles.summaryRow)}>
								<input
									type="text"
									value={message}
									onInput={(e) => onCommitMessageChange(e.currentTarget.value)}
									placeholder="Message"
									data-git-commit-message
									{...stylex.props(styles.summaryInput)}
									onKeyDown={(e) => {
										if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
											e.preventDefault();
											onCommit();
										}
									}}
								/>
								<button
									type="button"
									onClick={generateMessage}
									disabled={!stagedCount || generating || !cwd}
									title="Generate commit message"
									aria-label="Generate commit message"
									{...stylex.props(styles.generateMessageButton)}
								>
									{generating ? (
										<DotMatrixWeave
											size={iconSize._2md}
											dotSize={1.5}
											gap={1}
											speed={1.2}
											ariaLabel="Generating commit summary"
										/>
									) : (
										<IconSparkles size={iconSize.md} />
									)}
								</button>
							</div>
						</div>
					</Liquid.Item>
				</Liquid>
				<div {...stylex.props(styles.commitButtonSurface)}>
					<button
						type="button"
						onClick={onCommit}
						disabled={!commitMessage.trim() || isCommitting}
						{...stylex.props(styles.commitMainAction)}
					>
						<IconGitCommit size={iconSize.md} />
						{isCommitting
							? "Committing…"
							: stagedCount
								? `Commit ${stagedCount} file${stagedCount !== 1 ? "s" : ""}`
								: "Commit"}
					</button>
				</div>
			</div>
		</div>
	);
}

function CommitDetailsPanel({
	details,
	selectedFile,
	onSelectFile,
	viewMode,
}: {
	details: CommitDetails;
	selectedFile: SelectedFile | null;
	onSelectFile?: (file: CommitFile) => void;
	viewMode: "path" | "tree";
}) {
	return (
		<div {...stylex.props(styles.detailsRoot)}>
			<div {...stylex.props(styles.scrollArea)}>
				<HistoricalFileList
					files={details.files}
					selectedFile={selectedFile}
					viewMode={viewMode}
					onSelectFile={onSelectFile}
				/>
			</div>
			<div {...stylex.props(styles.detailsHeader)}>
				<p title={details.message} {...stylex.props(styles.commitMessage)}>
					{details.message}
				</p>
				{details.body ? (
					<div
						{...stylex.props(styles.commitDescriptionViewport)}
						style={{ maxHeight: "8.4em", overflow: "auto" }}
					>
						<p title={details.body} {...stylex.props(styles.commitDescription)}>
							{details.body}
						</p>
					</div>
				) : null}
				<div {...stylex.props(styles.detailIdentityGrid)}>
					<DetailIdentity
						name={details.author}
						email={details.authorEmail}
						date={details.authoredAt}
					/>
				</div>
			</div>
		</div>
	);
}

function detailInitials(name?: string | null) {
	const words = (typeof name === "string" ? name : "")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	return `${words[0]?.[0] ?? "?"}${words.length > 1 ? (words.at(-1)?.[0] ?? "") : ""}`.toLocaleUpperCase();
}

function formatDetailDate(value?: string | null) {
	const parsed = new Date(value ?? "");
	return Number.isNaN(parsed.getTime())
		? value || "Unknown date"
		: parsed.toLocaleString();
}

function DetailIdentity({
	label,
	name,
	email,
	date,
}: {
	label?: string;
	name?: string | null;
	email?: string | null;
	date?: string | null;
}) {
	const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
	const [avatarFailed, setAvatarFailed] = useState(false);
	useEffect(() => {
		let current = true;
		setAvatarUrl(null);
		setAvatarFailed(false);
		void resolveGitAuthorAvatar(email, name).then((url) => {
			if (current) setAvatarUrl(url);
		});
		return () => {
			current = false;
		};
	}, [email, name]);
	return (
		<div title={email ?? undefined} {...stylex.props(styles.detailIdentity)}>
			<span {...stylex.props(styles.detailAvatar)} aria-hidden="true">
				{avatarUrl && !avatarFailed ? (
					<img
						src={avatarUrl}
						alt=""
						loading="lazy"
						referrerPolicy="no-referrer"
						onError={() => setAvatarFailed(true)}
						{...stylex.props(styles.detailAvatarImage)}
					/>
				) : (
					detailInitials(name)
				)}
			</span>
			<span {...stylex.props(styles.detailIdentityCopy)}>
				{label ? (
					<span {...stylex.props(styles.detailIdentityLabel)}>{label}</span>
				) : null}
				<strong {...stylex.props(styles.authorText)}>
					{name || "Unknown author"}
				</strong>
				<span {...stylex.props(styles.mutedTextSmall)}>
					{formatDetailDate(date)}
				</span>
			</span>
		</div>
	);
}

function ComparisonDetailsPanel({
	details,
	selectionCount,
	selectedFile,
	onSelectFile,
	viewMode,
}: {
	details: ComparisonDetails;
	selectionCount: number;
	selectedFile: SelectedFile | null;
	onSelectFile?: (file: CommitFile) => void;
	viewMode: "path" | "tree";
}) {
	return (
		<div {...stylex.props(styles.detailsRoot)}>
			<div {...stylex.props(styles.scrollArea)}>
				{details.files.length ? (
					<HistoricalFileList
						files={details.files}
						selectedFile={selectedFile}
						viewMode={viewMode}
						onSelectFile={onSelectFile}
					/>
				) : (
					<div {...stylex.props(styles.emptyStateLarge)}>
						<p {...stylex.props(styles.mutedText)}>No file differences</p>
					</div>
				)}
			</div>
			<div {...stylex.props(styles.detailsHeader)}>
				<span {...stylex.props(styles.detailIdentityLabel)}>
					Comparing {selectionCount} items
				</span>
				<div {...stylex.props(styles.comparisonRange)}>
					<code title={details.fromHash}>{details.fromHash.slice(0, 7)}</code>
					<span aria-hidden="true">→</span>
					<code title={details.toHash}>
						{details.toHash === "WORKTREE" ? "WIP" : details.toHash.slice(0, 7)}
					</code>
				</div>
				{details.mergeBase ? (
					<span
						{...stylex.props(styles.mutedTextSmall)}
						title={details.mergeBase}
					>
						Merge base {details.mergeBase.slice(0, 7)}
					</span>
				) : null}
			</div>
		</div>
	);
}

function FileChangeTotals({
	additions,
	deletions,
}: {
	additions: number;
	deletions: number;
}) {
	return (
		<div
			{...stylex.props(styles.changeTotals)}
			title="Total additions and deletions"
		>
			<span {...stylex.props(styles.addedText)}>+{additions}</span>
			<span {...stylex.props(styles.deletedText)}>-{deletions}</span>
		</div>
	);
}

function FileViewToggle({
	value,
	onChange,
}: {
	value: "path" | "tree";
	onChange: (mode: "path" | "tree") => void;
}) {
	const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
	return (
		<div
			{...stylex.props(styles.segmented)}
			onMouseLeave={() => setHoveredIndex(null)}
		>
			<LiquidSegmentedRail
				activeIndex={hoveredIndex ?? (value === "path" ? 0 : 1)}
				itemCount={2}
				radius={6}
			/>
			{(["path", "tree"] as const).map((mode, index) => (
				<button
					type="button"
					key={mode}
					onMouseEnter={() => setHoveredIndex(index)}
					onClick={() => onChange(mode)}
					{...stylex.props(
						styles.segmentButton,
						value === mode && styles.segmentButtonActive,
					)}
				>
					{mode === "path" ? "Path" : "Tree"}
				</button>
			))}
		</div>
	);
}

function HistoricalFileList({
	files,
	selectedFile,
	viewMode,
	onSelectFile,
}: {
	files: CommitFile[];
	selectedFile: SelectedFile | null;
	viewMode: "path" | "tree";
	onSelectFile?: (file: CommitFile) => void;
}) {
	const orderedFiles = useMemo(
		() =>
			viewMode === "tree"
				? getTreeFileOrder(files)
				: getAlphabeticalFileOrder(files),
		[files, viewMode],
	);
	const entries = useMemo<GitFileEntry[]>(
		() => orderedFiles.map((file) => ({ ...file, staged: false })),
		[orderedFiles],
	);
	return (
		<FileGroup
			title="Changed"
			files={entries}
			selected={selectedFile}
			onSelect={(entry) => {
				const file = files.find(
					(candidate) =>
						candidate.path === entry.path &&
						candidate.originalPath === entry.originalPath,
				);
				if (file) onSelectFile?.(file);
			}}
			isCollapsible={false}
			showHeader={false}
			showFullPath
			viewMode={viewMode}
		/>
	);
}

function FileChangeIcon({
	file,
}: {
	file: { readonly path: string; readonly status: string };
}) {
	return (
		<span {...stylex.props(styles.fileChangeIcon)}>
			<FileTypeIcon path={file.path} size={iconSize._2lg} />
			<span {...stylex.props(styles.fileChangeMark)}>
				<FileStatusIcon status={file.status} />
			</span>
		</span>
	);
}

function FileStatusIcon({ status }: { status: string }) {
	switch (status) {
		case "M":
			return (
				<span
					{...stylex.props(styles.statusIcon, styles.modified)}
					title="Modified"
				>
					<IconPencil size={iconSize.sm} />
				</span>
			);
		case "A":
			return (
				<span
					{...stylex.props(styles.statusIcon, styles.addedStatus)}
					title="Added"
				>
					<IconPlus size={iconSize.xs} />
				</span>
			);
		case "D":
			return (
				<span
					{...stylex.props(styles.statusIcon, styles.deletedStatus)}
					title="Deleted"
				>
					<IconMinus size={iconSize.xs} />
				</span>
			);
		case "R":
			return (
				<span
					{...stylex.props(styles.statusIcon, styles.renamedStatus)}
					title="Renamed"
				>
					R
				</span>
			);
		case "?":
			return (
				<span
					{...stylex.props(styles.statusIcon, styles.addedStatus)}
					title="Untracked"
				>
					<IconPlus size={iconSize.xs} />
				</span>
			);
		default:
			return (
				<span
					{...stylex.props(styles.statusIcon, styles.defaultStatus)}
					title={status}
				>
					{status.charAt(0) || "•"}
				</span>
			);
	}
}

/* ── Tree helpers ─────────────────────────────────────── */

function TreeNodeRow({
	node,
	depth,
	selected,
	onSelect,
	onAction,
	actionLabel,
	hoveredActionPath,
	onActionHover,
	expandedDirs,
	toggleDir,
}: {
	node: FileTreeNode<GitFileEntry>;
	depth: number;
	selected: SelectedFile | null;
	onSelect: (f: GitFileEntry) => void;
	onAction?: (path: string) => void;
	actionLabel?: string;
	hoveredActionPath: string | null;
	onActionHover: (path: string | null) => void;
	expandedDirs: Set<string>;
	toggleDir: (path: string) => void;
}) {
	const isDir = node.children.size > 0 && !node.file;
	const isExpanded = expandedDirs.has(node.path);
	const file = node.file;
	const active =
		file && selected?.path === file.path && selected?.staged === file.staged;

	const sortedChildren = sortFileTreeChildren(node);
	const selectTreeNode = () => {
		if (isDir) {
			toggleDir(node.path);
		} else if (file) {
			onSelect(file);
		}
	};

	return (
		<>
			<div
				data-git-file-active={active ? "true" : undefined}
				{...stylex.props(styles.treeRow, active && styles.fileRowActive)}
				style={{ paddingLeft: `${4 + depth * 9}px`, paddingRight: 6 }}
				onMouseEnter={() => {
					if (!file) return;
					onActionHover(file.path);
				}}
				onMouseLeave={() => file && onActionHover(null)}
			>
				<button
					type="button"
					data-git-file-select
					{...stylex.props(styles.treeNodeButton)}
					onPointerDown={(event) => {
						if (event.button === 0 && event.isPrimary) selectTreeNode();
					}}
					onClick={(event) => {
						if (event.detail === 0) selectTreeNode();
					}}
				>
					{isDir ? (
						<>
							<IconChevronRight
								size={iconSize.sm}
								{...stylex.props(
									styles.chevron,
									isExpanded && styles.chevronOpen,
								)}
							/>
							<IconFolderFill
								size={iconSize.md}
								{...stylex.props(
									styles.folderIcon,
									isExpanded && styles.folderIconOpen,
								)}
							/>
							<span {...stylex.props(styles.treeName)}>{node.name}</span>
						</>
					) : file ? (
						<>
							<span {...stylex.props(styles.treeIndentSpacer)} />
							<FileChangeIcon file={file} />
							<span
								{...stylex.props(
									styles.treeFileName,
									active && styles.activeText,
								)}
							>
								{node.name}
							</span>
							{hoveredActionPath !== file.path ? (
								<FileDiffStats file={file} />
							) : null}
						</>
					) : null}
				</button>
				{file && onAction && (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onAction(file.path);
						}}
						{...stylex.props(
							styles.rowAction,
							hoveredActionPath === file.path && styles.rowActionVisible,
						)}
						aria-label={`${actionLabel} ${file.path}`}
					>
						<FileActionIcon actionLabel={actionLabel} />
					</button>
				)}
			</div>
			{isDir &&
				isExpanded &&
				sortedChildren.map((child) => (
					<TreeNodeRow
						key={child.path}
						node={child}
						depth={depth + 1}
						selected={selected}
						onSelect={onSelect}
						onAction={onAction}
						actionLabel={actionLabel}
						hoveredActionPath={hoveredActionPath}
						onActionHover={onActionHover}
						expandedDirs={expandedDirs}
						toggleDir={toggleDir}
					/>
				))}
		</>
	);
}

function FileGroup({
	title,
	files,
	selected,
	onSelect,
	actionLabel,
	onAction,
	onActionAll,
	isCollapsible = true,
	showHeader = true,
	showFullPath = false,
	viewMode = "path",
	splitPane = false,
}: {
	title: string;
	files: GitFileEntry[];
	selected: SelectedFile | null;
	onSelect: (f: GitFileEntry) => void;
	actionLabel?: string;
	onAction?: (path: string) => void;
	onActionAll?: () => void;
	isCollapsible?: boolean;
	showHeader?: boolean;
	showFullPath?: boolean;
	viewMode?: "path" | "tree";
	splitPane?: boolean;
}) {
	const [isCollapsed, setIsCollapsed] = useState(false);
	const [hoveredActionPath, setHoveredActionPath] = useState<string | null>(
		null,
	);
	const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
	const groupRef = useRef<HTMLDivElement | null>(null);
	const expandedDirs = useMemo(() => {
		if (viewMode !== "tree") return new Set<string>();
		const next = getExpandedFileDirectories(files);
		for (const path of collapsedDirs) next.delete(path);
		return next;
	}, [collapsedDirs, files, viewMode]);

	const toggleDir = useCallback((path: string) => {
		setCollapsedDirs((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	}, []);

	const tree = useMemo(() => buildFileTree(files), [files]);
	useEffect(() => {
		if (!selected) return;
		groupRef.current
			?.querySelector<HTMLElement>('[data-git-file-active="true"]')
			?.scrollIntoView?.({ block: "nearest" });
	}, [selected, viewMode]);
	const isEmpty = files.length === 0;
	const toggleGroup = () => {
		if (isCollapsible && !isEmpty) setIsCollapsed(!isCollapsed);
	};

	return (
		<div
			ref={groupRef}
			{...stylex.props(styles.fileGroup, splitPane && styles.splitFileGroup)}
		>
			{showHeader ? (
				<div
					{...stylex.props(
						styles.groupHeader,
						title === "Staged" && styles.groupHeaderSeparated,
					)}
				>
					<button
						type="button"
						onPointerDown={(event) => {
							if (event.button === 0 && event.isPrimary) toggleGroup();
						}}
						onClick={(event) => {
							if (event.detail === 0) toggleGroup();
						}}
						{...stylex.props(
							styles.groupToggle,
							isCollapsible && !isEmpty
								? styles.cursorPointer
								: styles.cursorDefault,
						)}
					>
						{isCollapsible && (
							<IconChevronRight
								size={iconSize.sm}
								{...stylex.props(
									styles.chevron,
									!isCollapsed && !isEmpty && styles.chevronOpen,
								)}
							/>
						)}
						<span {...stylex.props(styles.sectionTitle, styles.fileGroupTitle)}>
							{title} Files
						</span>
						<span {...stylex.props(styles.countPill)}>{files.length}</span>
					</button>
					{onActionAll && !isCollapsed && actionLabel && !isEmpty && (
						<button
							type="button"
							onClick={onActionAll}
							title={`${actionLabel} all files`}
							aria-label={`${actionLabel} all files`}
							{...stylex.props(styles.actionAllButton)}
						>
							<FileActionIcon actionLabel={actionLabel} />
						</button>
					)}
				</div>
			) : null}
			{isEmpty ? (
				<div {...stylex.props(styles.emptyGroupBody)}>
					<span {...stylex.props(styles.emptyGroupText)}>
						No {title.toLowerCase()} changes
					</span>
				</div>
			) : !isCollapsed ? (
				<div
					{...stylex.props(
						styles.groupList,
						splitPane && styles.splitGroupList,
					)}
				>
					{viewMode === "path" &&
						files.map((f) => {
							const active =
								selected?.path === f.path && selected?.staged === f.staged;
							return (
								<div
									key={`${f.staged ? "s" : "u"}-${f.path}`}
									data-git-file-active={active ? "true" : undefined}
									{...stylex.props(
										styles.pathRow,
										active && styles.fileRowActive,
									)}
									onMouseEnter={() => {
										setHoveredActionPath(f.path);
									}}
									onMouseLeave={() => setHoveredActionPath(null)}
								>
									<button
										type="button"
										data-git-file-select
										onPointerDown={(event) => {
											if (event.button === 0 && event.isPrimary) onSelect(f);
										}}
										onClick={(event) => {
											if (event.detail === 0) onSelect(f);
										}}
										{...stylex.props(styles.fileRowButton)}
										title={f.path}
									>
										<FileChangeIcon file={f} />
										<span {...stylex.props(styles.fileButton)}>
											<span
												{...stylex.props(
													styles.pathFileName,
													active && styles.activeText,
												)}
											>
												{showFullPath ? f.path : f.path.split("/").pop()}
											</span>
										</span>
										{hoveredActionPath !== f.path ? (
											<FileDiffStats file={f} />
										) : null}
									</button>
									{onAction && (
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												onAction(f.path);
											}}
											{...stylex.props(
												styles.rowActionSubtle,
												hoveredActionPath === f.path && styles.rowActionVisible,
											)}
											aria-label={`${actionLabel} ${f.path}`}
										>
											<FileActionIcon actionLabel={actionLabel} />
										</button>
									)}
								</div>
							);
						})}
					{viewMode === "tree" && (
						<div>
							{sortFileTreeChildren(tree).map((child) => (
								<TreeNodeRow
									key={child.path}
									node={child}
									depth={0}
									selected={selected}
									onSelect={onSelect}
									onAction={onAction}
									actionLabel={actionLabel}
									hoveredActionPath={hoveredActionPath}
									onActionHover={setHoveredActionPath}
									expandedDirs={expandedDirs}
									toggleDir={toggleDir}
								/>
							))}
						</div>
					)}
				</div>
			) : null}
		</div>
	);
}

function FileDiffStats({ file }: { file: GitFileEntry }) {
	const additions = file.additions ?? 0;
	const deletions = file.deletions ?? 0;
	if (additions === 0 && deletions === 0) return null;

	return (
		<span {...stylex.props(styles.fileStats)}>
			{additions > 0 && (
				<span {...stylex.props(styles.addedText)}>+{additions}</span>
			)}
			{deletions > 0 && (
				<span {...stylex.props(styles.deletedText)}>-{deletions}</span>
			)}
		</span>
	);
}
