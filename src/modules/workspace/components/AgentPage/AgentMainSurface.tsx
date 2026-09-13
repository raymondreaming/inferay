import * as stylex from "@stylexjs/stylex";
import { styles } from "./styles.ts";

type AgentMainSurfaceProps = {
	readonly active?: boolean;
	readonly repositoryCwd?: string;
	readonly paneCount?: number;
	readonly chatDiffPanel: import("solid-js").Element;
	readonly chatSidebar: import("solid-js").Element;
	readonly chatZenMode: boolean;
	readonly hasCurrentPanes: boolean;
	readonly agentGrid: import("solid-js").Element;
};
export function AgentMainSurface(_props: AgentMainSurfaceProps) {
	return (
		<div
			data-repository-surface={_props.repositoryCwd}
			data-repository-active={_props.active === false ? "false" : "true"}
			data-expected-panes={_props.paneCount}
			aria-hidden={_props.active === false ? "true" : undefined}
			{...stylex.attrs(
				styles.appRoot,
				styles.fullHeight,
				_props.active === false && styles.inactive,
			)}
		>
			<div {...stylex.attrs(styles.appFrame)}>
				<div {...stylex.attrs(styles.appColumn)}>
					<div {...stylex.attrs(styles.appBody)}>
						<div {...stylex.attrs(styles.mainPane)}>
							{!_props.hasCurrentPanes ? (
								<div {...stylex.attrs(styles.emptyWorkspace)} />
							) : (
								<div
									{...stylex.attrs(
										styles.surfaceLayer,
										styles.surfaceLayerVisible,
									)}
								>
									<div {...stylex.attrs(styles.repositoryWorkbench)}>
										<div
											{...stylex.attrs(
												styles.chatDock,
												_props.chatZenMode && styles.chatDockZen,
											)}
										>
											{_props.agentGrid}
										</div>
										{_props.chatDiffPanel}
										{_props.chatSidebar}
									</div>
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
