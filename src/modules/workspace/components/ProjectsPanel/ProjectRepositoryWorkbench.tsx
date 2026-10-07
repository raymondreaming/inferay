import { useRepositoryWorkbench } from "@repository/hooks/useRepositoryWorkbench.tsx";
import * as stylex from "@stylexjs/stylex";
import { For, onSettled } from "solid-js";
import { styles } from "./styles.ts";

export function ProjectRepositoryWorkbench(props: { path: string }) {
	const workbench = useRepositoryWorkbench(() => ({
		active: true,
		cwd: props.path,
		workspaceId: props.path,
	}));
	onSettled(() => workbench.showGraph());
	return (
		<section
			aria-label="Repository workspace"
			{...stylex.attrs(styles.repositoryWorkspace)}
		>
			<div {...stylex.attrs(styles.repositoryWorkbench)}>
				<div
					{...stylex.attrs(
						styles.repositoryGraph,
						workbench.auxiliaryPanels.length > 0 && styles.hidden,
					)}
				>
					{workbench.diffPanel}
				</div>
				<For each={workbench.auxiliaryPanels} keyed={(panel) => panel.id}>
					{(panel) => (
						<div
							{...stylex.attrs(styles.repositoryGraph)}
							onPointerDown={panel().onSelect}
						>
							{panel().render()}
						</div>
					)}
				</For>
				{workbench.sidebar}
			</div>
		</section>
	);
}
