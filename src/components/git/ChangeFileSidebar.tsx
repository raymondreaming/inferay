import * as stylex from "@stylexjs/stylex";
import { useCallback, useMemo, useState } from "react";
import type { GitFileEntry } from "../../features/git/types.ts";
import { postJson } from "../../lib/fetch-json.ts";
import {
	color,
	controlSize,
	effect,
	font,
	radius,
	shadow,
} from "../../tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { DotMatrixWeave } from "../ui/DotMatrixLoader.tsx";
import {
	IconChevronRight,
	IconFolderFill,
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

/* ── Main reusable changes sidebar component ──────────── */

export function ChangeFileSidebar({
	fileViewMode,
	onFileViewModeChange,
	mainViewMode,
	// Diff mode props
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
	// Graph mode props
	selectedCommitHash,
	commitDetailsLoading,
	commitDetails,
	files,
	branch,
	// Commit props
	commitMessage,
	onCommitMessageChange,
	onCommit,
	isCommitting,
	amendMode,
	onAmendModeChange,
	cwd,
	showFileActions = true,
	showCommitSection = true,
	onCollapse,
}: {
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
}) {
	return (
		<div {...stylex.props(styles.root)}>
			<ChangeFileSidebarHeader
				fileViewMode={fileViewMode}
				onFileViewModeChange={onFileViewModeChange}
				onCollapse={onCollapse}
			/>

			{mainViewMode !== "graph" && (
				<div {...stylex.props(styles.splitArea)}>
					{!hasProject ? (
						<div {...stylex.props(styles.emptyState)}>
							<p {...stylex.props(styles.emptyText, styles.centerText)}>
								No repository
							</p>
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
								{files.map((f, i) => (
									<div key={i} {...stylex.props(styles.commitFileRow)}>
										<FileStatusIcon status={f.status} />
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
								<p {...stylex.props(styles.mutedText)}>Loading...</p>
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

			{hasProject && mainViewMode !== "graph" && showCommitSection && (
				<CommitSection
					cwd={cwd}
					commitMessage={commitMessage}
					onCommitMessageChange={onCommitMessageChange}
					onCommit={onCommit}
					isCommitting={isCommitting}
					amendMode={amendMode}
					onAmendModeChange={onAmendModeChange}
					stagedCount={staged.length}
				/>
			)}
		</div>
	);
}

const styles = stylex.create({
	root: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		minWidth: 0,
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
	},
	emptyState: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		paddingBlock: controlSize._6,
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
		alignItems: "center",
		gap: controlSize._2,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.background,
		paddingInline: controlSize._3,
	},
	headerLabel: {
		color: color.textSoft,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		letterSpacing: "0.01em",
	},
	spacer: {
		flex: 1,
	},
	segmented: {
		display: "flex",
		height: controlSize._5,
		alignItems: "center",
		overflow: "hidden",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		backgroundColor: color.backgroundRaised,
	},
	segmentButton: {
		height: "100%",
		paddingInline: controlSize._2,
		color: color.textMuted,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		transitionProperty: "background-color, color",
		transitionDuration: "120ms",
		backgroundColor: {
			default: "transparent",
			":hover": color.controlHover,
		},
	},
	segmentButtonActive: {
		backgroundColor: color.controlActive,
		color: color.textMain,
	},
	headerIconButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlActive,
		},
		borderColor: color.border,
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
		backgroundColor: color.background,
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
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: color.border,
		backgroundColor: color.background,
	},
	commitHeader: {
		display: "flex",
		height: controlSize._9,
		alignItems: "center",
		justifyContent: "space-between",
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: color.border,
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
		color: color.textSoft,
		fontSize: "0.6875rem",
		fontWeight: font.weight_5,
	},
	generateButton: {
		height: controlSize._6,
		justifyContent: "center",
		paddingInline: 0,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		width: controlSize._7,
	},
	generateMark: {
		color: color.textSoft,
		display: "flex",
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
	checkbox: {
		width: font.size_3,
		height: font.size_3,
		accentColor: color.accent,
	},
	commitForm: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		paddingInline: controlSize._3,
		paddingBottom: controlSize._3,
	},
	commitEditor: {
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.controlDepth,
		borderColor: {
			default: color.border,
			":focus-within": color.borderStrong,
		},
		borderRadius: 12,
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
	summaryRow: {
		display: "flex",
		alignItems: "center",
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.borderSubtle,
	},
	summaryInput: {
		minWidth: 0,
		flex: 1,
		backgroundColor: "transparent",
		color: color.textMain,
		fontSize: font.size_3,
		fontWeight: font.weight_5,
		outline: "none",
		paddingBlock: controlSize._2_5,
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
		paddingBlock: controlSize._2_5,
		paddingInline: controlSize._3,
		"::placeholder": {
			color: color.textFaint,
		},
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
	},
	commitButton: {
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlHover,
		},
		backgroundImage: {
			default: effect.controlDepth,
			":hover": effect.controlDepthHover,
		},
		borderColor: {
			default: color.border,
			":hover": color.borderStrong,
		},
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: {
			default: shadow.composerFrame,
			":hover": shadow.composerFrameFocus,
		},
		color: color.textMain,
		gap: controlSize._2,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
		justifyContent: "center",
		minHeight: controlSize._9,
		width: "100%",
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
		color: "var(--color-git-added)",
	},
	deletedText: {
		color: "var(--color-git-deleted)",
	},
	statusIcon: {
		flexShrink: 0,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		width: "18px",
		height: "18px",
		borderRadius: "0.125rem",
		fontSize: font.size_1,
		fontWeight: 700,
		lineHeight: 1,
	},
	modified: {
		color: "#fbbf24",
	},
	addedStatus: {
		color: "var(--color-git-added)",
		backgroundColor: "rgba(35, 134, 54, 0.15)",
	},
	deletedStatus: {
		color: "var(--color-git-deleted)",
		backgroundColor: "rgba(248, 81, 73, 0.15)",
	},
	renamedStatus: {
		color: "#60a5fa",
		backgroundColor: "rgba(96, 165, 250, 0.15)",
	},
	defaultStatus: {
		color: color.textMuted,
		backgroundColor: "rgba(255, 255, 255, 0.08)",
	},
	fileGroup: {
		display: "flex",
		flex: 1,
		minHeight: 0,
		flexDirection: "column",
	},
	emptyGroupBody: {
		flex: 1,
		minHeight: 0,
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
		height: controlSize._9,
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
		color: color.textSoft,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		fontVariantNumeric: "tabular-nums",
		paddingInline: controlSize._1_5,
	},
	actionAllButton: {
		height: controlSize._6,
		justifyContent: "center",
		paddingInline: 0,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		width: controlSize._6,
	},
	groupList: {
		flex: 1,
		minHeight: 0,
		overflowY: "auto",
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
	fileRowActive: {
		borderLeftColor: "var(--color-inferay-accent)",
		backgroundColor: "rgba(29, 185, 84, 0.08)",
	},
	fileButton: {
		minWidth: 0,
		flex: 1,
		display: "flex",
		flexDirection: "column",
		textAlign: "left",
		backgroundColor: "transparent",
	},
	pathFileName: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textSoft,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		lineHeight: 1.3,
		transitionProperty: "color",
		transitionDuration: "120ms",
	},
	activeText: {
		color: color.textMain,
	},
	pathDir: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_1,
		lineHeight: 1.3,
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
			":hover": "rgba(29, 185, 84, 0.16)",
		},
		borderColor: {
			default: "rgba(255, 255, 255, 0.12)",
			":hover": "rgba(29, 185, 84, 0.55)",
		},
		color: {
			default: color.textSoft,
			":hover": "var(--color-inferay-accent)",
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
		fontWeight: font.weight_6,
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
	fileViewMode,
	onFileViewModeChange,
	onCollapse,
}: {
	fileViewMode: "path" | "tree";
	onFileViewModeChange: (mode: "path" | "tree") => void;
	onCollapse?: () => void;
}) {
	return (
		<div {...stylex.props(styles.sidebarHeader)}>
			<span {...stylex.props(styles.headerLabel)}>Files</span>
			<span {...stylex.props(styles.spacer)} />
			<div {...stylex.props(styles.segmented)}>
				<button
					type="button"
					onClick={() => onFileViewModeChange("path")}
					title="Path view"
					{...stylex.props(
						styles.segmentButton,
						fileViewMode === "path" && styles.segmentButtonActive
					)}
				>
					Path
				</button>
				<button
					type="button"
					onClick={() => onFileViewModeChange("tree")}
					title="Tree view"
					{...stylex.props(
						styles.segmentButton,
						fileViewMode === "tree" && styles.segmentButtonActive
					)}
				>
					Tree
				</button>
			</div>
			{onCollapse && (
				<button
					type="button"
					onClick={onCollapse}
					title="Hide sidebar"
					{...stylex.props(styles.headerIconButton)}
				>
					<IconPanelLeft size={12} />
				</button>
			)}
		</div>
	);
}

function CommitSection({
	cwd,
	commitMessage,
	onCommitMessageChange,
	onCommit,
	isCommitting,
	amendMode,
	onAmendModeChange,
	stagedCount,
}: {
	cwd?: string;
	commitMessage: string;
	onCommitMessageChange: (msg: string) => void;
	onCommit: () => void;
	isCommitting: boolean;
	amendMode: boolean;
	onAmendModeChange: (v: boolean) => void;
	stagedCount: number;
}) {
	const [generating, setGenerating] = useState(false);
	const summary = commitMessage.split("\n")[0] || "";
	const description = commitMessage.split("\n").slice(1).join("\n");

	const generateMessage = async () => {
		if (!cwd || !stagedCount || generating) return;
		setGenerating(true);
		try {
			const data = await postJson<{ message?: string }>(
				"/api/git/generate-commit-message",
				{ cwd }
			);
			if (data.message) onCommitMessageChange(data.message);
		} catch {
			// ignore
		} finally {
			setGenerating(false);
		}
	};

	return (
		<div {...stylex.props(styles.commitSection)}>
			<div {...stylex.props(styles.commitHeader)}>
				<div {...stylex.props(styles.inlineGroup)}>
					<IconGitCommit size={12} {...stylex.props(styles.mutedIcon)} />
					<span {...stylex.props(styles.sectionTitle)}>Commit</span>
				</div>
				<Button
					type="button"
					onClick={generateMessage}
					disabled={!stagedCount || generating || !cwd}
					aria-label={
						generating
							? "Generating commit message"
							: "Generate commit message from staged changes"
					}
					title="Generate commit message from staged changes"
					variant="secondary"
					size="sm"
					className={stylex.props(styles.generateButton).className}
				>
					<span {...stylex.props(styles.generateMark)}>
						<DotMatrixWeave
							size={15}
							dotSize={2}
							gap={1}
							speed={generating ? 1.35 : 0.35}
						/>
					</span>
				</Button>
			</div>

			<label {...stylex.props(styles.checkRow)}>
				<input
					type="checkbox"
					checked={amendMode}
					onChange={(e) => onAmendModeChange(e.target.checked)}
					{...stylex.props(styles.checkbox)}
				/>
				<span {...stylex.props(styles.mutedTextSmall)}>
					Amend previous commit
				</span>
			</label>

			<div {...stylex.props(styles.commitForm)}>
				<div {...stylex.props(styles.commitEditor)}>
					<div {...stylex.props(styles.summaryRow)}>
						<input
							type="text"
							value={summary}
							onChange={(e) => {
								const lines = commitMessage.split("\n");
								lines[0] = e.target.value;
								onCommitMessageChange(lines.join("\n"));
							}}
							placeholder="Commit summary"
							{...stylex.props(
								styles.summaryInput,
								generating && styles.summaryInputGenerating
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
						{summary.length > 0 && (
							<span
								{...stylex.props(
									styles.summaryCount,
									summary.length > 72 && styles.warningText
								)}
							>
								{summary.length}
							</span>
						)}
					</div>
					<div {...stylex.props(styles.descriptionWrap)}>
						<textarea
							value={description}
							onChange={(e) => {
								const sum = commitMessage.split("\n")[0] || "";
								onCommitMessageChange(
									sum + (e.target.value ? `\n${e.target.value}` : "")
								);
							}}
							placeholder="Description"
							{...stylex.props(
								styles.descriptionInput,
								generating && styles.descriptionInputGenerating
							)}
							rows={4}
						/>
						{generating && (
							<span {...stylex.props(styles.descriptionThinking)}>
								<DotMatrixWeave
									size={13}
									dotSize={1.5}
									gap={1}
									speed={1.2}
									ariaLabel="Generating commit description"
								/>
							</span>
						)}
					</div>
				</div>

				<Button
					type="button"
					onClick={onCommit}
					disabled={!commitMessage.trim() || isCommitting}
					variant="secondary"
					size="sm"
					className={stylex.props(styles.commitButton).className}
				>
					<IconGitCommit size={12} />
					{isCommitting
						? "Committing..."
						: stagedCount
							? `Commit ${stagedCount} file${stagedCount !== 1 ? "s" : ""}`
							: "Commit"}
				</Button>
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
				{details.files.map((file, i) => (
					<div
						key={i}
						{...stylex.props(styles.commitFileRow, styles.cursorPointer)}
					>
						<FileStatusIcon status={file.status} />
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
					A
				</span>
			);
		case "D":
			return (
				<span
					{...stylex.props(styles.statusIcon, styles.deletedStatus)}
					title="Deleted"
				>
					D
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
					{...stylex.props(styles.statusIcon, styles.addedText)}
					title="Untracked"
				>
					<IconPlus size={10} />
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
	return [...node.children.values()].sort((a, b) => {
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
				onClick={() => {
					if (isDir) {
						toggleDir(node.path);
					} else if (file) {
						onSelect(file);
					}
				}}
			>
				{isDir ? (
					<>
						<IconChevronRight
							size={10}
							{...stylex.props(
								styles.chevron,
								isExpanded && styles.chevronOpen
							)}
						/>
						<IconFolderFill
							size={12}
							{...stylex.props(
								styles.folderIcon,
								isExpanded && styles.folderIconOpen
							)}
						/>
						<span {...stylex.props(styles.treeName)}>{node.name}</span>
					</>
				) : file ? (
					<>
						<span {...stylex.props(styles.treeIndentSpacer)} />
						<FileStatusIcon status={file.status} />
						<span
							{...stylex.props(
								styles.treeFileName,
								active && styles.activeText
							)}
						>
							{node.name}
						</span>
						<FileDiffStats file={file} />
						{onAction && (
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									onAction(file.path);
								}}
								{...stylex.props(
									styles.rowAction,
									hoveredActionPath === file.path && styles.rowActionVisible
								)}
								title={`${actionLabel} ${file.path}`}
							>
								<FileActionIcon actionLabel={actionLabel} />
							</button>
						)}
					</>
				) : null}
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
		null
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
			<div {...stylex.props(styles.groupHeader)}>
				<button
					type="button"
					onClick={() =>
						isCollapsible && !isEmpty && setIsCollapsed(!isCollapsed)
					}
					{...stylex.props(
						styles.groupToggle,
						isCollapsible && !isEmpty
							? styles.cursorPointer
							: styles.cursorDefault
					)}
				>
					{isCollapsible && (
						<IconChevronRight
							size={10}
							{...stylex.props(
								styles.chevron,
								!isCollapsed && !isEmpty && styles.chevronOpen
							)}
						/>
					)}
					<span {...stylex.props(styles.sectionTitle)}>{title} Files</span>
					<span {...stylex.props(styles.countPill)}>{files.length}</span>
				</button>
				{onActionAll && !isCollapsed && actionLabel && !isEmpty && (
					<Button
						type="button"
						onClick={onActionAll}
						title={`${actionLabel} all files`}
						variant="secondary"
						size="sm"
						className={stylex.props(styles.actionAllButton).className}
					>
						<FileActionIcon actionLabel={actionLabel} />
					</Button>
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
										active && styles.fileRowActive
									)}
									onMouseEnter={() => {
										setHoveredActionPath(f.path);
									}}
									onMouseLeave={() => setHoveredActionPath(null)}
								>
									<FileStatusIcon status={f.status} />
									<button
										type="button"
										onClick={() => onSelect(f)}
										{...stylex.props(styles.fileButton)}
										title={f.path}
									>
										<span
											{...stylex.props(
												styles.pathFileName,
												active && styles.activeText
											)}
										>
											{f.path}
										</span>
									</button>
									<FileDiffStats file={f} />
									{onAction && (
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												onAction(f.path);
											}}
											{...stylex.props(
												styles.rowActionSubtle,
												hoveredActionPath === f.path && styles.rowActionVisible
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
