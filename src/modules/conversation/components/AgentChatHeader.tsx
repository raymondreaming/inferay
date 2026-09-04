import * as stylex from "@octanejs/stylex";
import { memo, useMemo } from "octane";
import { APP_REGION_NO_DRAG_CLASS } from "../../../app/model/appearance.ts";
import {
	color,
	controlSize,
	font,
	iconSize,
	radius,
} from "../../../design-system/styles.stylex.ts";
import type { AgentKind } from "../../../modules/workspace/model/workspace-model.ts";
import {
	DropdownButton,
	type DropdownOption,
} from "../../../shared/ui/DropdownButton.tsx";
import { IconFolder } from "../../../shared/ui/Icons.tsx";

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

interface AgentWorkspaceControlProps {
	paneId: string;
	cwd?: string;
	sessions?: AgentChatSession[];
	onSelectSession?: (paneId: string) => void;
	onAgentContext?: () => void;
	isAgentContextOpen?: boolean;
}

export const AgentWorkspaceControl = memo(function AgentWorkspaceControl({
	paneId,
	cwd,
	sessions,
	onSelectSession,
	onAgentContext,
	isAgentContextOpen,
}: AgentWorkspaceControlProps) {
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
						icon: <IconFolder size={iconSize.sm} />,
					}))
				: [],
		[hasMultipleSessions, sessions],
	);
	const projectButtonProps = stylex.props(
		styles.projectButton,
		isAgentContextOpen && styles.projectButtonActive,
	);

	return (
		<>
			{dirName && hasMultipleSessions ? (
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
			) : dirName ? (
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
					<IconFolder size={iconSize.sm} />
					<span {...stylex.props(styles.sessionLabel)}>{dirName}</span>
				</button>
			) : null}
		</>
	);
});

const styles = stylex.create({
	projectButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		borderRadius: radius.md,
		borderWidth: 0,
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
		cursor: "pointer",
		display: "inline-flex",
		flexShrink: 1,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		height: controlSize._7,
		maxWidth: "min(50%, 12rem)",
		minWidth: controlSize._0,
		overflow: "hidden",
		paddingBlock: controlSize._0,
		paddingInline: controlSize._2,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	projectButtonActive: {
		backgroundColor: color.controlActive,
		color: color.textMain,
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
});
