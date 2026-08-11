import * as stylex from "@octanejs/stylex";
import { memo, useCallback, useMemo, useState } from "octane";
import type { AgentKind } from "../../features/agent/agent-utils.ts";
import { getAgentIcon } from "../../features/agents/agent-ui.tsx";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
} from "../../lib/app-theme.ts";
import { fetchJsonOr, postJson } from "../../lib/fetch-json.ts";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
} from "../../tokens.stylex.ts";
import { DropdownButton, type DropdownOption } from "../ui/DropdownButton.tsx";
import { IconGitBranch, IconSettings, IconX } from "../ui/Icons.tsx";

export interface AgentChatSession {
	paneId: string;
	cwd?: string;
	agentKind: AgentKind;
	paneTitle?: string;
	summary?: string | null;
}

function SessionDropdownOption({
	option,
	isSelected,
}: {
	option: DropdownOption;
	isSelected: boolean;
}) {
	return (
		<div
			{...stylex.props(
				styles.sessionOption,
				isSelected && styles.sessionOptionSelected
			)}
		>
			<span {...stylex.props(styles.sessionOptionIcon)}>{option.icon}</span>
			<div {...stylex.props(styles.sessionOptionText)}>
				<span {...stylex.props(styles.sessionOptionRepo)}>{option.label}</span>
				<span {...stylex.props(styles.sessionOptionTitle)}>
					{option.detail}
				</span>
			</div>
		</div>
	);
}

interface AgentChatHeaderProps {
	paneId: string;
	cwd?: string;
	gitBranch: string | null;
	draggable?: boolean;
	onDragStart?: (e: DragEvent) => void;
	onDragEnd?: () => void;
	onClose?: (paneId: string) => void;
	sessions?: AgentChatSession[];
	onSelectSession?: (paneId: string) => void;
	onGitBranchChanged?: (branch?: string) => void;
	onAgentContext?: () => void;
	isAgentContextOpen?: boolean;
}

interface GitBranch {
	name: string;
	current: boolean;
}

export const BranchDropdown = memo(function BranchDropdown({
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
	const [loadedCwd, setLoadedCwd] = useState<string | null>(null);
	const loadBranches = useCallback(
		async (force = false) => {
			if (!force && loadedCwd === cwd) return;
			const payload = await fetchJsonOr<{ branches?: GitBranch[] }>(
				`/api/git/branches?cwd=${encodeURIComponent(cwd)}`,
				{ branches: [] }
			);
			setBranches(Array.isArray(payload.branches) ? payload.branches : []);
			setLoadedCwd(cwd);
		},
		[cwd, loadedCwd]
	);
	const options = useMemo(() => {
		const source =
			loadedCwd === cwd && branches.length
				? branches
				: [{ name: branch, current: true }];
		return source.map((item) => ({
			id: item.name,
			label: item.name,
			icon: <IconGitBranch size={11} />,
		}));
	}, [branch, branches, cwd, loadedCwd]);
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
				await loadBranches(true);
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
				onOpen={() => void loadBranches()}
			/>
			{error && <span {...stylex.props(styles.branchError)}>{error}</span>}
		</span>
	);
});

export const AgentChatHeader = memo(function AgentChatHeader({
	paneId,
	cwd,
	gitBranch,
	draggable,
	onDragStart,
	onDragEnd,
	onClose,
	sessions,
	onSelectSession,
	onGitBranchChanged,
	onAgentContext,
	isAgentContextOpen,
}: AgentChatHeaderProps) {
	const dirName = cwd ? cwd.split("/").pop() || cwd : null;
	const hasMultipleSessions = !!(
		sessions &&
		sessions.length > 1 &&
		onSelectSession
	);
	const sessionOptions = useMemo(
		() =>
			hasMultipleSessions
				? (sessions ?? []).map((session) => ({
						id: session.paneId,
						label:
							(session.cwd ?? "").split("/").pop() ||
							session.cwd ||
							"No directory",
						detail: session.summary || session.paneTitle || "New chat session",
						icon: getAgentIcon(session.agentKind, 12),
					}))
				: [],
		[hasMultipleSessions, sessions]
	);
	const closeButtonProps = stylex.props(styles.closeButton);
	const contextButtonProps = stylex.props(
		styles.contextButton,
		isAgentContextOpen && styles.contextButtonActive
	);
	const projectButtonProps = stylex.props(styles.projectButton);
	const rootProps = stylex.props(styles.root, draggable && styles.draggable);

	return (
		<div
			className={`${APP_REGION_DRAG_CLASS} ${rootProps.className ?? ""}`}
			draggable={draggable}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
		>
			{onAgentContext && (
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						onAgentContext();
					}}
					{...contextButtonProps}
					className={`${APP_REGION_NO_DRAG_CLASS} ${contextButtonProps.className ?? ""}`}
					title="Agent Instructions"
				>
					<IconSettings size={10} />
				</button>
			)}
			{dirName &&
				(hasMultipleSessions ? (
					<span className={APP_REGION_NO_DRAG_CLASS}>
						<DropdownButton
							value={paneId}
							options={sessionOptions}
							onChange={onSelectSession}
							minWidth={220}
							maxVisibleOptions={6}
							optionHeight={48}
							renderOption={SessionDropdownOption}
							buttonClassName={
								stylex.props(styles.headerDropdownButton).className
							}
							labelClassName={stylex.props(styles.sessionLabel).className}
						/>
					</span>
				) : (
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							onAgentContext?.();
						}}
						{...projectButtonProps}
						className={`${APP_REGION_NO_DRAG_CLASS} ${projectButtonProps.className ?? ""}`}
						title={cwd}
					>
						{dirName}
					</button>
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
});

const styles = stylex.create({
	root: {
		alignItems: "center",
		backgroundColor: color.transparent,
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
	projectButton: {
		backgroundColor: color.transparent,
		borderWidth: 0,
		color: {
			default: color.textMain,
			":hover": color.textSoft,
		},
		cursor: "pointer",
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		overflow: "hidden",
		padding: 0,
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
	sessionOption: {
		display: "flex",
		height: 48,
		alignItems: "center",
		gap: controlSize._2,
		paddingInline: controlSize._3,
		backgroundColor: {
			default: "transparent",
			":hover": color.controlHover,
		},
	},
	sessionOptionSelected: {
		backgroundColor: color.controlActive,
	},
	sessionOptionIcon: {
		display: "flex",
		flexShrink: 0,
		color: color.textSoft,
	},
	sessionOptionText: {
		display: "flex",
		minWidth: 0,
		flex: 1,
		flexDirection: "column",
		gap: 2,
		textAlign: "left",
	},
	sessionOptionRepo: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
	},
	sessionOptionTitle: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_1,
	},
	branchError: {
		color: color.danger,
		fontSize: font.size_0_5,
		maxWidth: 96,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
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
	contextButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		borderRadius: radius.sm,
		borderWidth: 0,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		cursor: "pointer",
		display: "flex",
		flexShrink: 0,
		height: controlSize._5,
		justifyContent: "center",
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, color",
		transitionTimingFunction: motion.ease,
		width: controlSize._5,
	},
	contextButtonActive: {
		backgroundColor: color.controlActive,
		color: color.textMain,
	},
	spacer: {
		flex: 1,
		minWidth: 0,
	},
});
