import { iconSize } from "@design-system/styles.stylex.ts";
import { APP_REGION_NO_DRAG_CLASS, ariaValue } from "@shared/lib/dom.tsx";
import { IconGitBranch, IconPanelRight } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { styles } from "./styles.ts";

/** Workspace-independent controls for toggling repository graph and changes panes. */
export function RepositoryPanelControls(props: {
	graphVisible: boolean;
	hasActiveWorkspace: boolean;
	onToggleGraph: () => void;
	onToggleSidebar: () => void;
	sidebarVisible: boolean;
}) {
	const buttonProps = stylex.attrs(
		styles.panelToggle,
		styles.changesSidebarToggle,
	);
	return (
		<div
			role="group"
			aria-label="Repository panels"
			{...stylex.attrs(styles.panelControls)}
		>
			<button
				type="button"
				onClick={props.onToggleGraph}
				disabled={!props.hasActiveWorkspace}
				aria-label="Toggle commit graph"
				title="Toggle commit graph"
				aria-pressed={ariaValue(props.graphVisible)}
				{...buttonProps}
				class={`${APP_REGION_NO_DRAG_CLASS} ${buttonProps.class ?? ""}`}
			>
				<IconGitBranch size={iconSize.md} />
			</button>
			<button
				type="button"
				onClick={props.onToggleSidebar}
				disabled={!props.hasActiveWorkspace}
				aria-label="Toggle changes sidebar"
				aria-pressed={ariaValue(props.sidebarVisible)}
				title="Toggle changes sidebar"
				{...buttonProps}
				class={`${APP_REGION_NO_DRAG_CLASS} ${buttonProps.class ?? ""}`}
			>
				<IconPanelRight size={iconSize.md} />
			</button>
		</div>
	);
}
