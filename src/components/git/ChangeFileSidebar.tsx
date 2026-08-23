import * as stylex from "@octanejs/stylex";
import { useCallback, useMemo, useState } from "octane";
import type { GitFileEntry } from "../../features/git/types.ts";
import { postJson } from "../../lib/fetch-json.ts";
import {
	color,
	colorValues,
	controlSize,
	font,
	radius,
	shadow,
} from "../../tokens.stylex.ts";
import { FileTypeIcon } from "../file/FileTypeIcon.tsx";
import { DotMatrixWeave } from "../ui/DotMatrixLoader.tsx";
import { Liquid } from "../ui/gooey/index.ts";
import { LiquidSegmentedRail } from "../ui/gooey/LiquidSegmentedRail.tsx";
import {
	IconChevronRight,
	IconFolderFill,
	IconGitBranch,
	IconGitCommit,
	IconMinus,
	IconPanelLeft,
	IconPencil,
	IconPlus,
} from "../ui/Icons.tsx";

export interface SelectedFile {
	path: string;
	staged: boolean;
}

interface ChangeFileSidebarProps {
	cwd?: string;
	fileViewMode: "path" | "tree";
	onFileViewModeChange: (mode: "path" | "tree") => void;
	mainViewMode: "diff" | "graph";
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
	commitDetailsLoading: boolean;
	commitDetails: {
		hash: string;
		message: string;
		author: string;
		date: string;
		files: Array<{
			path: string;
			status: string;
			additions: number;
			deletions: number;
		}>;
	} | null;
	files: GitFileEntry[];
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
}

/* ── Main reusable changes sidebar component ──────────── */

export function ChangeFileSidebar(props: ChangeFileSidebarProps) {
	const {
		fileViewMode,
		onFileViewModeChange,
		mainViewMode,
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
		commitDetailsLoading,
		commitDetails,
		files,
		branch,
		commitMessage,
		onCommitMessageChange,
		onCommit,
		isCommitting,
		cwd,
		showFileActions = false,
		showCommitSection = true,
		onCollapse,
	} = props;
	const workingFiles = [...modified, ...untracked, ...staged];
	const additions = workingFiles.reduce(
		(total, file) => total + (file.additions ?? 0),
		0,
	);
	const deletions = workingFiles.reduce(
		(total, file) => total + (file.deletions ?? 0),
		0,
	);
	return (
		<div {...stylex.props(styles.root)}>
			<ChangeFileSidebarHeader
				onCollapse={onCollapse}
				branch={branch}
				additions={additions}
				deletions={deletions}
			/>

			{hasProject && mainViewMode !== "graph" && showCommitSection && (
				<CommitSection
					cwd={cwd}
					commitMessage={commitMessage}
					onCommitMessageChange={onCommitMessageChange}
					onCommit={onCommit}
					isCommitting={isCommitting}
					stagedCount={staged.length}
					fileViewMode={fileViewMode}
					onFileViewModeChange={onFileViewModeChange}
				/>
			)}

			{mainViewMode !== "graph" && (
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
								files={[...modified, ...untracked]}
								selected={selectedFile}
								onSelect={onSelectFile}
								actionLabel={showFileActions ? "Stage" : undefined}
								onAction={showFileActions ? onStageFile : undefined}
								onActionAll={showFileActions ? onStageAll : undefined}
								viewMode={fileViewMode}
							/>
							<FileGroup
								title="Staged"
								files={staged}
								selected={selectedFile}
								onSelect={onSelectFile}
								actionLabel={showFileActions ? "Unstage" : undefined}
								onAction={showFileActions ? onUnstageFile : undefined}
								onActionAll={showFileActions ? onUnstageAll : undefined}
								viewMode={fileViewMode}
							/>
						</>
					)}
				</div>
			)}

			{mainViewMode === "graph" && (
				<div {...stylex.props(styles.scrollArea)}>
					{selectedCommitHash === "wip" ? (
						<>
							<div {...stylex.props(styles.wipHeader)}>
								<div {...stylex.props(styles.wipDot)} />
								<span {...stylex.props(styles.wipTitle)}>
									WIP on {branch ?? "branch"}
								</span>
								<span {...stylex.props(styles.wipCount)}>
									{files.length} files
								</span>
							</div>
							<div {...stylex.props(styles.listPad)}>
								{files.map((f) => (
									<div
										key={`${f.path}:${f.status}`}
										{...stylex.props(styles.commitFileRow)}
									>
										<FileChangeIcon file={f} />
										<span {...stylex.props(styles.fileName)}>{f.path}</span>
									</div>
								))}
								{files.length === 0 && (
									<div {...stylex.props(styles.emptyState)}>
										<p {...stylex.props(styles.emptyText)}>No changes</p>
									</div>
								)}
							</div>
						</>
					) : selectedCommitHash ? (
						commitDetailsLoading ? (
							<div {...stylex.props(styles.emptyStateLarge)}>
								<p {...stylex.props(styles.mutedText)}>Loading…</p>
							</div>
						) : commitDetails ? (
							<CommitDetailsPanel details={commitDetails} />
						) : (
							<div {...stylex.props(styles.emptyStateLarge)}>
								<p {...stylex.props(styles.mutedText)}>No details</p>
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
}

export function CollapsedChangeFileSidebar({
	stagedCount,
	unstagedCount,
	onExpand,
}: {
	stagedCount: number;
	unstagedCount: number;
	onExpand: () => void;
}) {
	return (
		<div {...stylex.props(styles.collapsedRoot)}>
			<button
				type="button"
				onClick={onExpand}
				title="Expand files sidebar"
				aria-label="Expand files sidebar"
				{...stylex.props(styles.collapsedToggle)}
			>
				<IconPanelLeft size={13} />
			</button>
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
}

const styles = stylex.create({
	root: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		minWidth: 0,
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
			default: "transparent",
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
		width: 5,
		height: 5,
		borderRadius: radius.pill,
		backgroundColor: color.warning,
	},
	stagedDot: {
		width: 5,
		height: 5,
		borderRadius: radius.pill,
		backgroundColor: color.gitAdded,
	},
	scrollArea: {
		flex: 1,
		minHeight: 0,
		overflowY: "auto",
	},
	splitArea: {
		display: "flex",
		flex: 1,
		minHeight: 0,
		flexDirection: "column",
		overflowY: "auto",
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
		color: "rgba(255, 255, 255, 0.25)",
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
		top: 0,
		zIndex: 20,
		display: "flex",
		height: controlSize._8,
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._2,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.transparent,
		paddingInline: controlSize._3,
		paddingBlock: 0,
	},
	headerLabel: {
		color: color.textSoft,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		letterSpacing: "0.01em",
	},
	headerMeta: {
		display: "flex",
		width: "100%",
		minWidth: 0,
		alignItems: "center",
		gap: controlSize._1_5,
		paddingLeft: controlSize._1,
		color: color.textMuted,
		fontFamily: font.familyDiff,
		fontSize: font.size_1,
	},
	branchName: {
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontFamily: font.familyDiff,
		fontSize: font.size_1,
	},
	headerBranch: {
		display: "flex",
		minWidth: 0,
		marginLeft: "auto",
		alignItems: "center",
		gap: controlSize._1_5,
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
		zIndex: 1,
		height: "100%",
		paddingInline: controlSize._2,
		color: color.textMuted,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		borderRadius: radius.md,
		transitionProperty: "color",
		transitionDuration: "120ms",
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
		transitionDuration: "120ms",
	},
	wipHeader: {
		position: "sticky",
		top: 0,
		zIndex: 10,
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.transparent,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	wipDot: {
		width: font.size_3,
		height: font.size_3,
		borderRadius: "999px",
		borderWidth: 2,
		borderStyle: "dashed",
		borderColor: "var(--color-inferay-accent)",
	},
	wipTitle: {
		color: color.textMain,
		fontSize: "0.6875rem",
		fontWeight: font.weight_5,
	},
	wipCount: {
		marginLeft: "auto",
		color: color.textMuted,
		fontSize: font.size_1,
	},
	listPad: {
		paddingBlock: controlSize._1,
	},
	commitSection: {
		flexShrink: 0,
		backgroundColor: color.transparent,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
	},
	commitHeader: {
		display: "flex",
		height: controlSize._9,
		alignItems: "center",
		justifyContent: "space-between",
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		paddingInline: controlSize._3,
		gap: controlSize._2,
	},
	inlineGroup: {
		display: "flex",
		alignItems: "center",
		gap: "0.375rem",
	},
	inlineGroupWide: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
	},
	mutedIcon: {
		color: color.textMuted,
	},
	sectionTitle: {
		color: color.textMain,
		fontSize: "0.6875rem",
		fontWeight: font.weight_5,
	},
	fileGroupTitle: {
		color: color.textSoft,
		fontSize: font.size_2,
	},
	generateButton: {
		backgroundColor: {
			default: color.controlActive,
			":hover": color.surfaceControlHover,
		},
		backgroundImage: "none",
		borderColor: color.border,
		boxShadow: "none",
		height: controlSize._5,
		justifyContent: "center",
		paddingInline: controlSize._3,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
	},
	checkRow: {
		display: "flex",
		cursor: "pointer",
		alignItems: "center",
		gap: controlSize._2,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
		backgroundColor: {
			default: "transparent",
			":hover": color.surfaceSubtle,
		},
	},
	checkboxInput: {
		position: "absolute",
		opacity: 0,
		pointerEvents: "none",
	},
	checkbox: {
		display: "inline-flex",
		width: font.size_3,
		height: font.size_3,
		alignItems: "center",
		justifyContent: "center",
		borderColor: color.borderStrong,
		borderRadius: radius.sm,
		borderStyle: "solid",
		borderWidth: 1,
		backgroundColor: color.surfaceInset,
		color: color.background,
		flexShrink: 0,
	},
	checkboxChecked: {
		borderColor: color.textMuted,
		backgroundColor: color.textSoft,
	},
	commitForm: {
		display: "flex",
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
		transitionDuration: "150ms",
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
		minWidth: 0,
		height: "100%",
		flex: 1,
		backgroundColor: "transparent",
		color: color.textMain,
		fontSize: font.size_3,
		fontWeight: font.weight_5,
		outline: "none",
		paddingBlock: 0,
		paddingInline: controlSize._3,
		"::placeholder": {
			color: color.textFaint,
		},
	},
	summaryInputGenerating: {
		paddingRight: controlSize._2,
	},
	fieldThinking: {
		alignItems: "center",
		color: color.accent,
		display: "flex",
		flexShrink: 0,
		justifyContent: "center",
		marginRight: controlSize._2,
		transform: "scale(0.82)",
	},
	summaryCount: {
		flexShrink: 0,
		paddingRight: controlSize._3,
		color: color.textMuted,
		fontSize: font.size_1,
		fontVariantNumeric: "tabular-nums",
	},
	warningText: {
		color: color.warning,
	},
	descriptionInput: {
		width: "100%",
		resize: "none",
		backgroundColor: "transparent",
		color: color.textMain,
		fontSize: font.size_2,
		outline: "none",
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
		"::placeholder": {
			color: color.textFaint,
		},
	},
	fileTypeIcon: {
		display: "block",
		width: 17,
		height: 17,
		flexShrink: 0,
	},
	descriptionWrap: {
		position: "relative",
	},
	descriptionInputGenerating: {
		paddingRight: controlSize._8,
	},
	descriptionThinking: {
		color: color.accent,
		position: "absolute",
		right: controlSize._3,
		top: controlSize._2_5,
		transform: "scale(0.82)",
	},
	commitButton: {
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlActive,
		},
		backgroundImage: "none",
		borderColor: {
			default: color.border,
			":hover": color.borderStrong,
		},
		borderStyle: "solid",
		borderWidth: 1,
		borderRadius: radius.lg,
		boxShadow: "none",
		color: color.textMain,
		gap: controlSize._2,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
		justifyContent: "center",
		height: controlSize._8,
		minHeight: controlSize._8,
		width: "100%",
	},
	compactCheckRow: {
		display: "flex",
		width: "fit-content",
		cursor: "pointer",
		alignItems: "center",
		gap: controlSize._1_5,
		paddingInline: controlSize._1,
	},
	commitSplitWrap: {
		position: "relative",
	},
	commitSplitButton: {
		display: "flex",
		width: "100%",
		height: controlSize._7,
		overflow: "hidden",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: "#f4f4f2",
		borderRadius: radius.md,
		backgroundColor: "#f4f4f2",
		boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, 0.12)",
	},
	commitMainAction: {
		display: "flex",
		minWidth: 0,
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		gap: controlSize._1_5,
		backgroundColor: {
			default: "transparent",
			":hover": "rgba(0, 0, 0, 0.06)",
		},
		color: "#111210",
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		":disabled": {
			color: "#111210",
			opacity: 1,
			WebkitTextFillColor: "#111210",
		},
	},
	commitChevronAction: {
		display: "flex",
		width: controlSize._7,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: "rgba(0, 0, 0, 0.14)",
		backgroundColor: {
			default: "transparent",
			":hover": "rgba(0, 0, 0, 0.06)",
		},
		color: "#292a27",
		":disabled": {
			color: "#292a27",
			opacity: 1,
			WebkitTextFillColor: "#292a27",
		},
	},
	chevronDown: {
		transform: "rotate(90deg)",
	},
	commitActionMenu: {
		position: "absolute",
		right: 0,
		top: "calc(100% + 4px)",
		zIndex: 80,
		width: 190,
		padding: controlSize._1,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.borderStrong,
		borderRadius: radius.md,
		backgroundColor: color.backgroundRaised,
		boxShadow: "0 12px 28px rgba(0, 0, 0, 0.42)",
	},
	commitGenerateAction: {
		display: "flex",
		width: "100%",
		height: controlSize._7,
		alignItems: "center",
		paddingInline: controlSize._2,
		borderRadius: radius.sm,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		fontSize: font.size_2,
		textAlign: "left",
	},
	fileViewToolbar: {
		display: "flex",
		height: controlSize._8,
		alignItems: "center",
		gap: controlSize._2,
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: color.border,
		paddingInline: controlSize._3,
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
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		padding: controlSize._3,
	},
	hashText: {
		color: "var(--color-inferay-accent)",
		fontFamily:
			"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
		fontSize: "0.6875rem",
		fontWeight: font.weight_5,
	},
	commitMessage: {
		color: color.textMain,
		fontSize: "0.6875rem",
		lineHeight: 1.55,
	},
	authorText: {
		color: color.textSoft,
		fontSize: font.size_2,
	},
	detailsSubheader: {
		flexShrink: 0,
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: "rgba(255, 255, 255, 0.06)",
		backgroundColor: "rgba(255, 255, 255, 0.02)",
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	detailsFooter: {
		flexShrink: 0,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		gap: controlSize._3,
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: color.border,
		fontSize: font.size_2,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	commitFileRow: {
		display: "flex",
		alignItems: "center",
		gap: "0.375rem",
		paddingBlock: "0.375rem",
		paddingInline: controlSize._3,
		backgroundColor: {
			default: "transparent",
			":hover": "rgba(255, 255, 255, 0.05)",
		},
	},
	fileName: {
		minWidth: 0,
		flex: 1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textSoft,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
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
		color: "#32e875",
	},
	deletedText: {
		color: "#ff5252",
	},
	statusIcon: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		fontSize: 7,
		fontWeight: 700,
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
		width: 8,
		height: 8,
		pointerEvents: "none",
	},
	modified: {
		color: "#ffd23f",
	},
	addedStatus: {
		color: "#32e875",
	},
	deletedStatus: {
		color: "#ff5252",
	},
	renamedStatus: {
		color: "#74a7ff",
	},
	defaultStatus: {
		color: color.textSoft,
	},
	fileGroup: {
		display: "flex",
		flexShrink: 0,
		flexDirection: "column",
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
		position: "sticky",
		top: 0,
		zIndex: 10,
		display: "flex",
		height: controlSize._8,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "space-between",
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.background,
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
		backgroundColor: "transparent",
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
		transitionDuration: "120ms",
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
		padding: 0,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		backgroundColor: "transparent",
	},
	groupList: {
		flexShrink: 0,
		backgroundColor: color.transparent,
	},
	pathRow: {
		position: "relative",
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
		borderLeftWidth: 2,
		borderLeftStyle: "solid",
		borderLeftColor: "transparent",
		paddingBlock: controlSize._1,
		paddingInline: controlSize._3,
		transitionProperty: "background-color, border-color",
		transitionDuration: "120ms",
		backgroundColor: {
			default: "transparent",
			":hover": color.surfaceSubtle,
		},
	},
	treeRow: {
		position: "relative",
		display: "flex",
		height: controlSize._5,
		cursor: "pointer",
		alignItems: "center",
		gap: controlSize._1,
		borderLeftWidth: 2,
		borderLeftStyle: "solid",
		borderLeftColor: "transparent",
		transitionProperty: "background-color, border-color",
		transitionDuration: "120ms",
		backgroundColor: {
			default: "transparent",
			":hover": color.surfaceSubtle,
		},
	},
	treeNodeButton: {
		alignItems: "center",
		backgroundColor: "transparent",
		cursor: "pointer",
		display: "flex",
		flex: 1,
		gap: controlSize._1,
		height: "100%",
		minWidth: 0,
		padding: 0,
		textAlign: "left",
	},
	fileRowActive: {
		borderLeftColor: color.borderStrong,
		backgroundColor: color.surfaceInset,
	},
	fileButton: {
		minWidth: 0,
		flex: 1,
		display: "flex",
		flexDirection: "column",
		textAlign: "left",
		backgroundColor: "transparent",
	},
	fileRowButton: {
		display: "flex",
		minWidth: 0,
		flex: 1,
		alignItems: "center",
		gap: controlSize._2,
		backgroundColor: "transparent",
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
		transitionDuration: "120ms",
	},
	activeText: {
		color: color.textMain,
	},
	rowAction: {
		position: "absolute",
		right: controlSize._2,
		top: "50%",
		zIndex: 10,
		transform: "translateY(-50%)",
		display: "flex",
		width: "1.125rem",
		height: "1.125rem",
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: "rgba(255, 255, 255, 0.12)",
		borderRadius: "999px",
		backgroundColor: "rgba(12, 14, 13, 0.92)",
		color: color.textSoft,
		opacity: 0,
		pointerEvents: "none",
		transitionProperty: "opacity, color, border-color, background-color",
		transitionDuration: "120ms",
	},
	rowActionVisible: {
		opacity: 1,
		pointerEvents: "auto",
		backgroundColor: {
			default: "rgba(12, 14, 13, 0.92)",
			":hover": color.controlActive,
		},
		borderColor: {
			default: "rgba(255, 255, 255, 0.12)",
			":hover": color.borderStrong,
		},
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
	},
	rowActionSubtle: {
		position: "absolute",
		right: controlSize._2,
		top: "50%",
		zIndex: 10,
		transform: "translateY(-50%)",
		display: "flex",
		width: "1.125rem",
		height: "1.125rem",
		alignItems: "center",
		justifyContent: "center",
		borderRadius: "999px",
		color: color.textSoft,
		opacity: 0,
		pointerEvents: "none",
		transitionProperty: "opacity, color, background-color",
		transitionDuration: "120ms",
	},
	folderIcon: {
		flexShrink: 0,
		color: color.textMuted,
		transitionProperty: "color",
		transitionDuration: "120ms",
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
		minWidth: 0,
		flex: 1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		transitionProperty: "color",
		transitionDuration: "120ms",
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

function ChangeFileSidebarHeader({
	onCollapse,
	branch,
	additions,
	deletions,
}: {
	onCollapse?: () => void;
	branch?: string;
	additions: number;
	deletions: number;
}) {
	return (
		<div {...stylex.props(styles.sidebarHeader)}>
			{onCollapse ? (
				<button
					type="button"
					onClick={onCollapse}
					title="Collapse files sidebar"
					aria-label="Collapse files sidebar"
					{...stylex.props(styles.headerIconButton)}
				>
					<IconPanelLeft size={12} />
				</button>
			) : null}
			<div
				{...stylex.props(styles.changeTotals)}
				title="Total additions and deletions"
			>
				<span {...stylex.props(styles.addedText)}>+{additions}</span>
				<span {...stylex.props(styles.deletedText)}>-{deletions}</span>
			</div>
			<div {...stylex.props(styles.headerBranch)}>
				<IconGitBranch size={11} {...stylex.props(styles.mutedIcon)} />
				<span
					{...stylex.props(styles.branchName)}
					title={branch ?? "Repository"}
				>
					{branch ?? "Repository"}
				</span>
			</div>
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
	fileViewMode,
	onFileViewModeChange,
}: {
	cwd?: string;
	commitMessage: string;
	onCommitMessageChange: (msg: string) => void;
	onCommit: () => void;
	isCommitting: boolean;
	stagedCount: number;
	fileViewMode: "path" | "tree";
	onFileViewModeChange: (mode: "path" | "tree") => void;
}) {
	const [generating, setGenerating] = useState(false);
	const [generationMenuOpen, setGenerationMenuOpen] = useState(false);
	const [hoveredViewIndex, setHoveredViewIndex] = useState<number | null>(null);
	const message = commitMessage.replace(/\s+/g, " ");

	const generateMessage = async () => {
		if (!cwd || !stagedCount || generating) return;
		setGenerating(true);
		try {
			setGenerationMenuOpen(false);
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
					fill={colorValues.backgroundRaised}
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
									{...stylex.props(
										styles.summaryInput,
										generating && styles.summaryInputGenerating,
									)}
									onKeyDown={(e) => {
										if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
											e.preventDefault();
											onCommit();
										}
									}}
								/>
								{generating && (
									<span {...stylex.props(styles.fieldThinking)}>
										<DotMatrixWeave
											size={13}
											dotSize={1.5}
											gap={1}
											speed={1.2}
											ariaLabel="Generating commit summary"
										/>
									</span>
								)}
							</div>
						</div>
					</Liquid.Item>
				</Liquid>
				<div {...stylex.props(styles.commitSplitWrap)}>
					<div {...stylex.props(styles.commitSplitButton)}>
						<button
							type="button"
							onClick={onCommit}
							disabled={!commitMessage.trim() || isCommitting}
							{...stylex.props(styles.commitMainAction)}
						>
							<IconGitCommit size={12} />
							{isCommitting
								? "Committing…"
								: stagedCount
									? `Commit ${stagedCount} file${stagedCount !== 1 ? "s" : ""}`
									: "Commit"}
						</button>
						<button
							type="button"
							onClick={() => setGenerationMenuOpen((open) => !open)}
							disabled={!stagedCount || generating || !cwd}
							aria-label="Commit message actions"
							aria-expanded={generationMenuOpen}
							{...stylex.props(styles.commitChevronAction)}
						>
							<IconChevronRight
								size={11}
								{...stylex.props(styles.chevronDown)}
							/>
						</button>
					</div>
					{generationMenuOpen ? (
						<div {...stylex.props(styles.commitActionMenu)}>
							<button
								type="button"
								onClick={generateMessage}
								{...stylex.props(styles.commitGenerateAction)}
							>
								{generating ? "Generating…" : "Generate message"}
							</button>
						</div>
					) : null}
				</div>
			</div>

			<div {...stylex.props(styles.fileViewToolbar)}>
				<div
					{...stylex.props(styles.segmented)}
					onMouseLeave={() => setHoveredViewIndex(null)}
				>
					<LiquidSegmentedRail
						activeIndex={hoveredViewIndex ?? (fileViewMode === "path" ? 0 : 1)}
						itemCount={2}
						radius={6}
					/>
					<button
						type="button"
						onMouseEnter={() => setHoveredViewIndex(0)}
						onClick={() => onFileViewModeChange("path")}
						{...stylex.props(
							styles.segmentButton,
							fileViewMode === "path" && styles.segmentButtonActive,
						)}
					>
						Path
					</button>
					<button
						type="button"
						onMouseEnter={() => setHoveredViewIndex(1)}
						onClick={() => onFileViewModeChange("tree")}
						{...stylex.props(
							styles.segmentButton,
							fileViewMode === "tree" && styles.segmentButtonActive,
						)}
					>
						Tree
					</button>
				</div>
			</div>
		</div>
	);
}

function CommitDetailsPanel({
	details,
}: {
	details: {
		hash: string;
		message: string;
		author: string;
		date: string;
		files: Array<{
			path: string;
			status: string;
			additions: number;
			deletions: number;
		}>;
	};
}) {
	return (
		<div {...stylex.props(styles.detailsRoot)}>
			<div {...stylex.props(styles.detailsHeader)}>
				<div {...stylex.props(styles.inlineGroupWide)}>
					<span {...stylex.props(styles.hashText)}>
						{details.hash.slice(0, 7)}
					</span>
					<span {...stylex.props(styles.mutedText)}>{details.date}</span>
				</div>
				<p {...stylex.props(styles.commitMessage)}>{details.message}</p>
				<p {...stylex.props(styles.authorText)}>{details.author}</p>
			</div>

			<div {...stylex.props(styles.detailsSubheader)}>
				<span {...stylex.props(styles.sectionTitle)}>Files Changed</span>
				<span {...stylex.props(styles.mutedTextSmall)}>
					{details.files.length}
				</span>
			</div>

			<div {...stylex.props(styles.scrollArea)}>
				{details.files.map((file) => (
					<div
						key={file.path}
						{...stylex.props(styles.commitFileRow, styles.cursorPointer)}
					>
						<FileChangeIcon file={file} />
						<span {...stylex.props(styles.fileName)}>
							{file.path.split("/").pop()}
						</span>
						<div {...stylex.props(styles.fileStats)}>
							{file.additions > 0 && (
								<span {...stylex.props(styles.addedText)}>
									+{file.additions}
								</span>
							)}
							{file.deletions > 0 && (
								<span {...stylex.props(styles.deletedText)}>
									-{file.deletions}
								</span>
							)}
						</div>
					</div>
				))}
			</div>

			<div {...stylex.props(styles.detailsFooter)}>
				<span {...stylex.props(styles.addedText)}>
					+{details.files.reduce((sum, f) => sum + f.additions, 0)}
				</span>
				<span {...stylex.props(styles.deletedText)}>
					-{details.files.reduce((sum, f) => sum + f.deletions, 0)}
				</span>
			</div>
		</div>
	);
}

function FileChangeIcon({
	file,
}: {
	file: { readonly path: string; readonly status: string };
}) {
	return (
		<span {...stylex.props(styles.fileChangeIcon)}>
			<FileTypeIcon path={file.path} size={15} />
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
					<IconPencil size={10} />
				</span>
			);
		case "A":
			return (
				<span
					{...stylex.props(styles.statusIcon, styles.addedStatus)}
					title="Added"
				>
					<IconPlus size={8} />
				</span>
			);
		case "D":
			return (
				<span
					{...stylex.props(styles.statusIcon, styles.deletedStatus)}
					title="Deleted"
				>
					<IconMinus size={8} />
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
					<IconPlus size={8} />
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

interface TreeNode {
	name: string;
	path: string;
	children: Map<string, TreeNode>;
	file?: GitFileEntry;
}

function sortTreeChildren(node: TreeNode): TreeNode[] {
	return Array.from(node.children.values()).toSorted((a, b) => {
		const aIsDir = a.children.size > 0 && !a.file;
		const bIsDir = b.children.size > 0 && !b.file;
		if (aIsDir && !bIsDir) return -1;
		if (!aIsDir && bIsDir) return 1;
		return a.name.localeCompare(b.name);
	});
}

function buildFileTree(files: GitFileEntry[]): TreeNode {
	const root: TreeNode = { name: "", path: "", children: new Map() };

	for (const file of files) {
		const parts = file.path.split("/");
		let current = root;
		let currentPath = "";

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i]!;
			currentPath = currentPath ? `${currentPath}/${part}` : part;

			if (!current.children.has(part)) {
				current.children.set(part, {
					name: part,
					path: currentPath,
					children: new Map(),
				});
			}
			current = current.children.get(part)!;
			if (i === parts.length - 1) {
				current.file = file;
			}
		}
	}

	return root;
}

function getExpandedDirs(files: GitFileEntry[]): Set<string> {
	const dirs = new Set<string>();
	for (const f of files) {
		const parts = f.path.split("/");
		let path = "";
		for (let i = 0; i < parts.length - 1; i++) {
			path = path ? `${path}/${parts[i]}` : parts[i]!;
			dirs.add(path);
		}
	}
	return dirs;
}

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
	node: TreeNode;
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

	const sortedChildren = sortTreeChildren(node);
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
					{...stylex.props(styles.treeNodeButton)}
					onClick={selectTreeNode}
				>
					{isDir ? (
						<>
							<IconChevronRight
								size={10}
								{...stylex.props(
									styles.chevron,
									isExpanded && styles.chevronOpen,
								)}
							/>
							<IconFolderFill
								size={12}
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
							<FileDiffStats file={file} />
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
						title={`${actionLabel} ${file.path}`}
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
	viewMode = "path",
}: {
	title: string;
	files: GitFileEntry[];
	selected: SelectedFile | null;
	onSelect: (f: GitFileEntry) => void;
	actionLabel?: string;
	onAction?: (path: string) => void;
	onActionAll?: () => void;
	isCollapsible?: boolean;
	viewMode?: "path" | "tree";
}) {
	const [isCollapsed, setIsCollapsed] = useState(false);
	const [hoveredActionPath, setHoveredActionPath] = useState<string | null>(
		null,
	);
	const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
	const expandedDirs = useMemo(() => {
		if (viewMode !== "tree") return new Set<string>();
		const next = getExpandedDirs(files);
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
	const isEmpty = files.length === 0;

	return (
		<div {...stylex.props(styles.fileGroup)}>
			<div
				{...stylex.props(
					styles.groupHeader,
					title === "Staged" && styles.groupHeaderSeparated,
				)}
			>
				<button
					type="button"
					onClick={() =>
						isCollapsible && !isEmpty && setIsCollapsed(!isCollapsed)
					}
					{...stylex.props(
						styles.groupToggle,
						isCollapsible && !isEmpty
							? styles.cursorPointer
							: styles.cursorDefault,
					)}
				>
					{isCollapsible && (
						<IconChevronRight
							size={10}
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
			{isEmpty ? (
				<div {...stylex.props(styles.emptyGroupBody)}>
					<span {...stylex.props(styles.emptyGroupText)}>
						No {title.toLowerCase()} changes
					</span>
				</div>
			) : !isCollapsed ? (
				<div {...stylex.props(styles.groupList)}>
					{viewMode === "path" &&
						files.map((f) => {
							const active =
								selected?.path === f.path && selected?.staged === f.staged;
							return (
								<div
									key={`${f.staged ? "s" : "u"}-${f.path}`}
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
										onClick={() => onSelect(f)}
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
												{f.path.split("/").pop()}
											</span>
										</span>
										<FileDiffStats file={f} />
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
											title={`${actionLabel} ${f.path}`}
										>
											<FileActionIcon actionLabel={actionLabel} />
										</button>
									)}
								</div>
							);
						})}
					{viewMode === "tree" && (
						<div>
							{sortTreeChildren(tree).map((child) => (
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
