import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getAgentIcon } from "../../features/agents/agent-ui.tsx";
import { getAgentDefinition } from "../../features/agents/agents.ts";
import type {
	AgentChatSession,
	WorktreeLaunchInfo,
} from "../../features/chat/agent-chat-shared.ts";
import { fetchJsonOr, postJson } from "../../lib/fetch-json.ts";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
} from "../../tokens.stylex.ts";
import { DropdownButton } from "../ui/DropdownButton.tsx";
import { IconGitBranch, IconX } from "../ui/Icons.tsx";

const APP_REGION_DRAG_CLASS = "electrobun-webkit-app-region-drag";
const APP_REGION_NO_DRAG_CLASS = "electrobun-webkit-app-region-no-drag";

interface AgentChatHeaderProps {
	paneId: string;
	cwd?: string;
	gitBranch: string | null;
	worktreeInfo?: WorktreeLaunchInfo | null;
	draggable?: boolean;
	onDragStart?: (e: React.DragEvent) => void;
	onDragEnd?: () => void;
	onClose?: (paneId: string) => void;
	sessions?: AgentChatSession[];
	onSelectSession?: (paneId: string) => void;
	onGitBranchChanged?: (branch?: string) => void;
}

interface GitBranch {
	name: string;
	current: boolean;
}

export function BranchDropdown({
	cwd,
	branch,
	onBranchChanged,
}: {
	cwd: string;
	branch: string;
	onBranchChanged?: (branch?: string) => void;
}) {
	const [branches, setBranches] = useState<GitBranch[]>([]);
	const [busyBranch, setBusyBranch] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const loadBranches = useCallback(async () => {
		const payload = await fetchJsonOr<{ branches?: GitBranch[] }>(
			`/api/git/branches?cwd=${encodeURIComponent(cwd)}`,
			{ branches: [] }
		);
		setBranches(Array.isArray(payload.branches) ? payload.branches : []);
	}, [cwd]);
	useEffect(() => {
		void loadBranches();
	}, [loadBranches]);
	const options = useMemo(() => {
		const source = branches.length
			? branches
			: [{ name: branch, current: true }];
		return source.map((item) => ({
			id: item.name,
			label: item.name,
			icon: <IconGitBranch size={11} />,
		}));
	}, [branch, branches]);
	const checkout = useCallback(
		async (nextBranch: string) => {
			if (nextBranch === branch || busyBranch) return;
			setBusyBranch(nextBranch);
			setError(null);
			try {
				const result = await postJson<{
					ok: boolean;
					branch?: string;
					error?: string;
				}>("/api/git/branches", { cwd, branch: nextBranch });
				if (!result.ok) throw new Error(result.error || "Unable to checkout");
				await loadBranches();
				onBranchChanged?.(result.branch ?? nextBranch);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Unable to checkout");
			} finally {
				setBusyBranch(null);
			}
		},
		[branch, busyBranch, cwd, loadBranches, onBranchChanged]
	);

	const branchWrapProps = stylex.props(styles.branchWrap);

	return (
		<span
			{...branchWrapProps}
			className={`${APP_REGION_NO_DRAG_CLASS} ${branchWrapProps.className ?? ""}`}
			title={error ?? branch}
		>
			<DropdownButton
				value={branch}
				options={options}
				onChange={checkout}
				minWidth={180}
				placeholder={busyBranch ? "Switching..." : branch}
				icon={<IconGitBranch size={9} />}
				buttonClassName={stylex.props(styles.headerDropdownButton).className}
				labelClassName={stylex.props(styles.branchLabel).className}
			/>
			{error && <span {...stylex.props(styles.branchError)}>{error}</span>}
		</span>
	);
}

export function AgentChatHeader({
	paneId,
	cwd,
	gitBranch,
	worktreeInfo,
	draggable,
	onDragStart,
	onDragEnd,
	onClose,
	sessions,
	onSelectSession,
	onGitBranchChanged,
}: AgentChatHeaderProps) {
	const dirName = cwd ? cwd.split("/").pop() || cwd : null;
	const hasMultipleSessions =
		sessions && sessions.length > 1 && onSelectSession;
	const isWorktree =
		!!cwd && !!worktreeInfo && cwd === worktreeInfo.worktreePath;
	const sessionOptions = hasMultipleSessions
		? sessions.map((session) => ({
				id: session.paneId,
				label:
					(session.cwd ?? "").split("/").pop() || session.cwd || "No directory",
				detail: getAgentDefinition(session.agentKind).label,
				icon: getAgentIcon(session.agentKind, 12),
			}))
		: [];
	const closeButtonProps = stylex.props(styles.closeButton);
	const rootProps = stylex.props(styles.root, draggable && styles.draggable);

	return (
		<div
			className={`${APP_REGION_DRAG_CLASS} ${rootProps.className ?? ""}`}
			draggable={draggable}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
		>
			{dirName &&
				(hasMultipleSessions ? (
					<span className={APP_REGION_NO_DRAG_CLASS}>
						<DropdownButton
							value={paneId}
							options={sessionOptions}
							onChange={onSelectSession}
							minWidth={220}
							buttonClassName={
								stylex.props(styles.headerDropdownButton).className
							}
							labelClassName={stylex.props(styles.sessionLabel).className}
						/>
					</span>
				) : (
					<span {...stylex.props(styles.title)} title={cwd}>
						{dirName}
					</span>
				))}
			{gitBranch && (
				<>
					<span {...stylex.props(styles.mutedText)}>›</span>
					{cwd ? (
						<BranchDropdown
							cwd={cwd}
							branch={gitBranch}
							onBranchChanged={onGitBranchChanged}
						/>
					) : (
						<span {...stylex.props(styles.branch)} title={gitBranch}>
							{gitBranch}
						</span>
					)}
				</>
			)}
			{isWorktree && (
				<span
					{...stylex.props(styles.worktreeBadge)}
					title={worktreeInfo.branchName}
				>
					worktree
				</span>
			)}
			<span {...stylex.props(styles.spacer)} />
			{onClose && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onClose(paneId);
					}}
					{...closeButtonProps}
					className={`${APP_REGION_NO_DRAG_CLASS} ${closeButtonProps.className ?? ""}`}
					title="Close"
				>
					<IconX size={8} />
				</button>
			)}
		</div>
	);
}

const styles = stylex.create({
	root: {
		alignItems: "center",
		backgroundColor: color.background,
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		flexShrink: 0,
		gap: controlSize._1_5,
		minHeight: controlSize._8,
		minWidth: 0,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._3,
		userSelect: "none",
	},
	draggable: {
		cursor: {
			default: "grab",
			":active": "grabbing",
		},
	},
	title: {
		color: color.textMain,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	mutedText: {
		color: color.textMuted,
		fontSize: font.size_1,
	},
	branch: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		maxWidth: 80,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	branchWrap: {
		alignItems: "center",
		display: "inline-flex",
		gap: controlSize._1,
		minWidth: 0,
	},
	headerDropdownButton: {
		"--dropdown-button-bg-color": "transparent",
		"--dropdown-button-bg-image": "none",
		"--dropdown-button-border-color": "transparent",
		"--dropdown-button-border-width": 0,
		"--dropdown-button-hover-bg-color": "transparent",
		"--dropdown-button-hover-bg-image": "none",
		"--dropdown-button-hover-shadow": "none",
		"--dropdown-button-open-bg-color": "transparent",
		"--dropdown-button-open-bg-image": "none",
		"--dropdown-button-open-border-color": "transparent",
		"--dropdown-button-open-shadow": "none",
		"--dropdown-button-shadow": "none",
		height: controlSize._5,
		borderRadius: radius.md,
		borderColor: color.transparent,
		borderWidth: 0,
		backgroundColor: {
			default: color.transparent,
			":hover": color.transparent,
		},
		backgroundImage: "none",
		boxShadow: "none",
		color: color.textSoft,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		paddingInline: controlSize._1_5,
	},
	branchLabel: {
		fontSize: font.size_1,
		maxWidth: "92px",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	sessionLabel: {
		fontSize: font.size_1,
		maxWidth: "120px",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	branchError: {
		color: color.danger,
		fontSize: font.size_0_5,
		maxWidth: 96,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	worktreeBadge: {
		backgroundColor: color.controlActive,
		borderColor: color.accentBorder,
		borderRadius: radius.sm,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		paddingBlock: 1,
		paddingInline: controlSize._1,
	},
	closeButton: {
		alignItems: "center",
		backgroundColor: {
			default: "transparent",
			":hover": color.dangerWash,
		},
		borderRadius: radius.sm,
		color: {
			default: color.textMuted,
			":hover": color.danger,
		},
		display: "flex",
		flexShrink: 0,
		height: controlSize._5,
		justifyContent: "center",
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, color",
		transitionTimingFunction: motion.ease,
		width: controlSize._5,
	},
	spacer: {
		flex: 1,
		minWidth: 0,
	},
});
