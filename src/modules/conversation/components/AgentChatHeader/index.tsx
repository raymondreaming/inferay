import * as stylex from "@octanejs/stylex";
import { memo } from "octane";
import { APP_REGION_NO_DRAG_CLASS } from "../../../../app/model/appearance.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconFolder } from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";

interface AgentWorkspaceControlProps {
	cwd?: string;

	onAgentContext?: () => void;
	isAgentContextOpen?: boolean;
}

export const AgentWorkspaceControl = memo(function AgentWorkspaceControl({
	cwd,

	onAgentContext,
	isAgentContextOpen,
}: AgentWorkspaceControlProps) {
	const dirName = cwd ? cwd.split("/").pop() || cwd : null;
	const projectButtonProps = stylex.props(
		styles.projectButton,
		isAgentContextOpen && styles.projectButtonActive,
	);

	return dirName ? (
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
	) : null;
});
