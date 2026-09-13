import { APP_REGION_NO_DRAG_CLASS } from "@app/hooks/useAppAppearance.tsx";
import { iconSize } from "@design-system/styles.stylex.ts";
import { IconFolder } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, Show } from "solid-js";
import { styles } from "./styles.ts";

export const AgentWorkspaceControl = function AgentWorkspaceControl(props: {
	cwd?: string;
	onAgentContext?: () => void;
	isAgentContextOpen?: boolean;
}) {
	const dirName = createMemo(() =>
		props.cwd ? props.cwd.split("/").pop() || props.cwd : null,
	);
	const projectButtonProps = createMemo(() =>
		stylex.attrs(
			styles.projectButton,
			props.isAgentContextOpen && styles.projectButtonActive,
		),
	);
	return (
		<Show when={dirName()}>
			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					props.onAgentContext?.();
				}}
				{...projectButtonProps()}
				class={`${APP_REGION_NO_DRAG_CLASS} ${projectButtonProps().class ?? ""}`}
				title={props.cwd}
			>
				<IconFolder size={iconSize.sm} />
				<span {...stylex.attrs(styles.sessionLabel)}>{dirName()}</span>
			</button>
		</Show>
	);
};
