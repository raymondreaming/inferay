import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import { APP_REGION_NO_DRAG_CLASS } from "../../../../app/hooks/useAppAppearance.tsx";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconFolder } from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";

interface AgentWorkspaceControlProps {
	cwd?: string;
	onAgentContext?: () => void;
	isAgentContextOpen?: boolean;
}
export const AgentWorkspaceControl = function AgentWorkspaceControl(
	_props: AgentWorkspaceControlProps,
) {
	const dirName = createMemo(() =>
		_props.cwd ? _props.cwd.split("/").pop() || _props.cwd : null,
	);
	const projectButtonProps = createMemo(() =>
		stylex.attrs(
			styles.projectButton,
			_props.isAgentContextOpen && styles.projectButtonActive,
		),
	);
	return dirName() ? (
		<button
			type="button"
			onClick={(event) => {
				event.stopPropagation();
				_props.onAgentContext?.();
			}}
			{...projectButtonProps()}
			class={`${APP_REGION_NO_DRAG_CLASS} ${projectButtonProps().class ?? ""}`}
			title={_props.cwd}
		>
			<IconFolder size={iconSize.sm} />
			<span {...stylex.attrs(styles.sessionLabel)}>{dirName()}</span>
		</button>
	) : null;
};
