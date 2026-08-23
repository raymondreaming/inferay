import * as stylex from "@octanejs/stylex";
import { useState } from "octane";
import type { RefObject } from "react";
import {
	type AgentChatHandle,
	AgentChatView,
} from "../../components/chat/AgentChatView.tsx";
import { ChatPaneBoundary } from "../../components/chat/ChatPaneBoundary.tsx";
import { FileTypeIcon } from "../../components/file/FileTypeIcon.tsx";
import { LiquidSegmentedRail } from "../../components/ui/gooey/LiquidSegmentedRail.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import {
	IconCollapse,
	IconExpand,
	IconGitBranch,
	IconLayoutGrid,
	IconSettings,
} from "../../components/ui/Icons.tsx";
import type { summarizeHunkDiff } from "../../features/git/useGitDiff.tsx";
import { color, controlSize, font } from "../../tokens.stylex.ts";
import type { DiffViewMode } from "../Agent/GitDiffView.tsx";

type EditorChatSession = {
	groupId: string;
	groupName: string;
	paneId: string;
	paneTitle: string;
	agentKind: "claude" | "codex";
	cwd?: string;
	referencePaths?: string[];
	pendingCwd?: boolean;
	messageCount: number;
	summary: string | null;
};

export function Placeholder({ label }: { label: string }) {
	return (
		<div {...stylex.props(styles.centerFull, styles.centerPad)}>
			<p {...stylex.props(styles.placeholderText)}>{label}</p>
		</div>
	);
}

export function InactiveSessionTopBar({
	onOpenSettings,
}: {
	onOpenSettings: () => void;
}) {
	return (
		<div {...stylex.props(styles.topBar)}>
			<span {...stylex.props(styles.topBarLabel)}>No active session</span>
			<span {...stylex.props(styles.spacer)} />
			<IconButton
				type="button"
				onClick={onOpenSettings}
				variant="ghost"
				size="xs"
				title="Settings"
			>
				<IconSettings size={10} />
			</IconButton>
		</div>
	);
}

export function EditorWorkspace({
	leading,
	toolbar,
	viewer,
	sidebar,
	zen,
}: {
	leading?: unknown;
	toolbar?: unknown;
	viewer: unknown;
	sidebar: unknown;
	zen?: boolean;
}) {
	const body = (
		<>
			{leading}
			<div {...stylex.props(toolbar ? styles.viewerColumn : styles.viewerPane)}>
				{toolbar}
				{toolbar ? (
					<div {...stylex.props(styles.diffHost)}>{viewer}</div>
				) : (
					viewer
				)}
			</div>
			{sidebar}
		</>
	);

	return zen ? (
		<div {...stylex.props(styles.zenLayout)}>{body}</div>
	) : (
		<aside {...stylex.props(styles.rightPane)}>
			<div {...stylex.props(styles.splitBody)}>{body}</div>
		</aside>
	);
}

const emptyWorkspaceViewer = <Placeholder label="No diff available" />;

export function EmptyEditorWorkspace({ sidebar }: { sidebar: unknown }) {
	return <EditorWorkspace viewer={emptyWorkspaceViewer} sidebar={sidebar} />;
}

export function EditorAgentChat({
	session,
	chatRef,
	gitBranch,
	onClose,
	sessions,
	onSelectSession,
	onDirectoryChange,
	composerOnly,
	composerOnlyOffsetX,
	onExitComposerOnly,
}: {
	session: EditorChatSession;
	chatRef: RefObject<AgentChatHandle | null>;
	gitBranch: string | null;
	onClose?: (paneId: string) => void;
	sessions?: EditorChatSession[];
	onSelectSession?: (paneId: string) => void;
	onDirectoryChange?: (
		paneId: string,
		cwd: string,
		referencePaths?: string[],
	) => void;
	composerOnly?: boolean;
	composerOnlyOffsetX?: number;
	onExitComposerOnly?: () => void;
}) {
	return (
		<ChatPaneBoundary key={session.paneId}>
			<AgentChatView
				ref={chatRef}
				paneId={session.paneId}
				cwd={session.cwd}
				referencePaths={session.referencePaths}
				gitBranch={gitBranch}
				agentKind={session.agentKind}
				onClose={onClose}
				sessions={sessions}
				onSelectSession={onSelectSession}
				onDirectoryChange={onDirectoryChange}
				composerOnly={composerOnly}
				composerOnlyOffsetX={composerOnlyOffsetX}
				onExitComposerOnly={onExitComposerOnly}
			/>
		</ChatPaneBoundary>
	);
}

function ToolbarButton({
	active,
	title,
	icon,
	onClick,
}: {
	active: boolean;
	title: string;
	icon: unknown;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			{...stylex.props(
				styles.toolbarButton,
				active && styles.toolbarButtonActive,
			)}
		>
			{icon}
		</button>
	);
}

export function DiffViewerTopBar({
	mainViewMode,
	diffViewMode,
	cwd,
	filePath,
	diffStats,
	onMainViewModeChange,
	onDiffViewModeChange,
	zenMode,
	onToggleZenMode,
}: {
	mainViewMode: "diff" | "graph";
	diffViewMode: DiffViewMode;
	cwd?: string;
	gitBranch: string | null;
	filePath?: string;
	diffStats: ReturnType<typeof summarizeHunkDiff>;
	onMainViewModeChange: (mode: "diff" | "graph") => void;
	onDiffViewModeChange: (mode: DiffViewMode) => void;
	onGitBranchChanged?: (branch?: string) => void;
	zenMode: boolean;
	onToggleZenMode: () => void;
}) {
	const [hoveredToolbarIndex, setHoveredToolbarIndex] = useState<number | null>(
		null,
	);
	const dirName = cwd ? cwd.split("/").pop() || cwd : null;
	const fileName = filePath?.split("/").pop() ?? filePath;

	return (
		<div {...stylex.props(styles.topBar)}>
			{dirName && (
				<span {...stylex.props(styles.headerTitle)} title={cwd}>
					{dirName}
				</span>
			)}
			{dirName && <span {...stylex.props(styles.headerDivider)} />}
			<div {...stylex.props(styles.segmented)}>
				<LiquidSegmentedRail
					activeIndex={0}
					itemCount={1}
					radius={12}
					fill="var(--color-inferay-gray)"
				/>
				<button
					type="button"
					onClick={() => onMainViewModeChange("diff")}
					{...stylex.props(
						styles.segmentButton,
						mainViewMode === "diff" && styles.segmentButtonActive,
					)}
				>
					Diff
				</button>
			</div>

			{filePath && (
				<span {...stylex.props(styles.fileIdentity)} title={filePath}>
					<FileTypeIcon path={filePath} size={14} />
					<span {...stylex.props(styles.filePathLabel)}>{fileName}</span>
				</span>
			)}
			{filePath && mainViewMode === "diff" && (
				<span {...stylex.props(styles.diffStatsLabel)}>
					{diffStats.added > 0 && (
						<span {...stylex.props(styles.addedText)}>+{diffStats.added}</span>
					)}
					{diffStats.removed > 0 && (
						<span {...stylex.props(styles.deletedText)}>
							-{diffStats.removed}
						</span>
					)}
				</span>
			)}
			<span {...stylex.props(styles.spacer)} />

			<div
				{...stylex.props(styles.segmented)}
				onMouseLeave={() => setHoveredToolbarIndex(null)}
			>
				<LiquidSegmentedRail
					activeIndex={
						hoveredToolbarIndex ??
						(zenMode ? 2 : diffViewMode === "split" ? 0 : 1)
					}
					itemCount={3}
					radius={10}
					fill="var(--color-inferay-gray)"
				/>
				<span onMouseEnter={() => setHoveredToolbarIndex(0)}>
					<ToolbarButton
						active={diffViewMode === "split"}
						title="Split diff"
						onClick={() => onDiffViewModeChange("split")}
						icon={<IconLayoutGrid size={11} />}
					/>
				</span>
				<span onMouseEnter={() => setHoveredToolbarIndex(1)}>
					<ToolbarButton
						active={diffViewMode === "hunks"}
						title="Hunk view"
						onClick={() => onDiffViewModeChange("hunks")}
						icon={<IconGitBranch size={11} />}
					/>
				</span>
				<span onMouseEnter={() => setHoveredToolbarIndex(2)}>
					<ToolbarButton
						active={zenMode}
						title={zenMode ? "Exit focus mode" : "Focus editor"}
						onClick={onToggleZenMode}
						icon={
							zenMode ? <IconCollapse size={11} /> : <IconExpand size={11} />
						}
					/>
				</span>
			</div>
		</div>
	);
}

const styles = stylex.create({
	rightPane: {
		display: "flex",
		minWidth: 0,
		minHeight: 0,
		flexDirection: "column",
		backgroundColor: color.transparent,
	},
	splitBody: {
		display: "flex",
		minHeight: 0,
		flex: 1,
		overflow: "hidden",
	},
	viewerPane: {
		display: "flex",
		minWidth: 0,
		minHeight: 0,
		flex: 1,
		flexDirection: "column",
		overflow: "hidden",
	},
	viewerColumn: {
		display: "flex",
		minWidth: 0,
		minHeight: 0,
		flex: 1,
		flexDirection: "column",
		overflow: "hidden",
	},
	diffHost: {
		minHeight: 0,
		flex: 1,
		overflow: "hidden",
	},
	zenLayout: {
		position: "relative",
		display: "flex",
		minHeight: 0,
		flex: 1,
	},
	centerFull: {
		display: "flex",
		height: "100%",
		alignItems: "center",
		justifyContent: "center",
	},
	centerPad: {
		paddingInline: controlSize._6,
	},
	topBar: {
		alignItems: "center",
		backgroundColor: color.transparent,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		display: "flex",
		flexShrink: 0,
		gap: controlSize._1_5,
		minHeight: controlSize._8,
		minWidth: 0,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._3,
	},
	topBarLabel: {
		color: color.textMuted,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
	},
	spacer: {
		flex: 1,
	},
	headerTitle: {
		color: color.textMain,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	headerMuted: {
		color: color.textMuted,
		fontSize: font.size_1,
	},
	headerBranch: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		maxWidth: 80,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	headerDivider: {
		backgroundColor: color.border,
		flexShrink: 0,
		height: controlSize._4,
		width: 1,
	},
	placeholderText: {
		maxWidth: "20rem",
		color: color.textMuted,
		fontSize: font.size_3,
		lineHeight: 1.65,
		textAlign: "center",
	},
	toolbarButton: {
		position: "relative",
		zIndex: 1,
		display: "flex",
		height: "100%",
		width: controlSize._6,
		alignItems: "center",
		justifyContent: "center",
		color: color.textMuted,
		borderRadius: "50%",
		transitionProperty: "color",
		transitionDuration: "120ms",
		backgroundColor: "transparent",
		":hover": {
			color: color.textSoft,
		},
	},
	toolbarButtonActive: {
		backgroundColor: color.transparent,
		color: color.textMain,
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
		color: color.textMuted,
		fontSize: "0.5rem",
		fontWeight: font.weight_5,
		paddingInline: controlSize._2,
		transitionProperty: "background-color, color",
		transitionDuration: "120ms",
		backgroundColor: {
			default: "transparent",
			":hover": color.controlHover,
		},
		":hover": {
			color: color.textSoft,
		},
	},
	segmentButtonActive: {
		backgroundColor: color.transparent,
		color: color.textMain,
	},
	filePathLabel: {
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontFamily: "var(--font-diff)",
		fontSize: font.size_1,
	},
	fileIdentity: {
		display: "flex",
		minWidth: 0,
		alignItems: "center",
		gap: controlSize._1_5,
	},
	diffStatsLabel: {
		alignItems: "center",
		color: color.textMuted,
		display: "flex",
		flexShrink: 0,
		fontSize: font.size_1,
		fontVariantNumeric: "tabular-nums",
		gap: controlSize._1,
	},
	addedText: {
		color: color.gitAdded,
	},
	deletedText: {
		color: color.gitDeleted,
	},
});
