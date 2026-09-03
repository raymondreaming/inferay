import * as stylex from "@octanejs/stylex";
import { memo, useMemo } from "octane";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
} from "../../app/theme.ts";
import { iconSize } from "../../design-system.ts";
import { getAgentIcon } from "../../modules/agents/agent-ui.tsx";
import { WorkspaceDockHandle } from "../../modules/workbench/WorkspaceDockHandle.tsx";
import type { AgentKind } from "../../modules/workspace/workspace-model.ts";
import {
	DropdownButton,
	type DropdownOption,
} from "../../shared/ui/DropdownButton.tsx";
import { IconSettings, IconX } from "../../shared/ui/Icons.tsx";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
} from "../../tokens.stylex.ts";

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
				isSelected && styles.sessionOptionSelected,
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
	draggable?: boolean;
	onDragStart?: (e: PointerEvent) => void;
	onDragEnd?: () => void;
	onClose?: (paneId: string) => void;
	sessions?: AgentChatSession[];
	onSelectSession?: (paneId: string) => void;
	onAgentContext?: () => void;
	isAgentContextOpen?: boolean;
}

export const AgentChatHeader = memo(function AgentChatHeader({
	paneId,
	cwd,
	draggable,
	onDragStart,
	onDragEnd,
	onClose,
	sessions,
	onSelectSession,
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
		[hasMultipleSessions, sessions],
	);
	const closeButtonProps = stylex.props(styles.closeButton);
	const contextButtonProps = stylex.props(
		styles.contextButton,
		isAgentContextOpen && styles.contextButtonActive,
	);
	const projectButtonProps = stylex.props(styles.projectButton);
	const rootProps = stylex.props(styles.root);

	return (
		<div className={`${APP_REGION_DRAG_CLASS} ${rootProps.className ?? ""}`}>
			<WorkspaceDockHandle
				draggable={draggable}
				onDragStart={onDragStart}
				onDragEnd={onDragEnd}
			/>
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
					<IconSettings size={iconSize.sm} />
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
					<IconX size={iconSize.xs} />
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
		minWidth: controlSize._0,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._3,
		userSelect: "none",
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
		padding: controlSize._0,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	mutedText: {
		color: color.textMuted,
		fontSize: font.size_1,
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
	sessionLabel: {
		fontSize: font.size_1,
		maxWidth: "120px",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	sessionOption: {
		display: "flex",
		height: controlSize._12,
		alignItems: "center",
		gap: controlSize._2,
		paddingInline: controlSize._3,
		backgroundColor: {
			default: color.transparent,
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
		minWidth: controlSize._0,
		flex: 1,
		flexDirection: "column",
		gap: controlSize._0_5,
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
	closeButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
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
		minWidth: controlSize._0,
	},
});
