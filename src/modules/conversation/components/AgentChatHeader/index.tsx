import * as stylex from "@octanejs/stylex";
import { memo, useMemo } from "octane";
import { APP_REGION_NO_DRAG_CLASS } from "../../../../app/model/appearance.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { DropdownButton } from "../../../../shared/ui/DropdownButton/index.tsx";
import { IconFolder } from "../../../../shared/ui/Icons/index.tsx";
import type { AgentKind } from "../../../workspace/model/workspace-model.ts";
import { SessionDropdownOption } from "./SessionDropdownOption.tsx";
import { styles } from "./styles.ts";

export interface AgentChatSession {
	paneId: string;
	cwd?: string;
	agentKind: AgentKind;
	paneTitle?: string;
	summary?: string | null;
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
