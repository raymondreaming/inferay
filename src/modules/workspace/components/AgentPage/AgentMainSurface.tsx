import * as stylex from "@octanejs/stylex";
import { Suspense } from "octane";
import type { ThemeId } from "../../model/workspace-model.ts";
import { type AgentPersistenceArgs, Settings } from "./shared.ts";
import { styles } from "./styles.ts";

type AgentMainSurfaceProps = {
	readonly chatDiffPanel: unknown;
	readonly chatSidebar: unknown;
	readonly chatZenMode: boolean;
	readonly hasCurrentPanes: boolean;
	readonly setAppearance: AgentPersistenceArgs["setAppearance"];
	readonly setShowSettings: (value: boolean) => void;
	readonly showSettings: boolean;
	readonly agentGrid: unknown;
	readonly themeId: ThemeId;
};

export function AgentMainSurface({
	chatDiffPanel,
	chatSidebar,
	chatZenMode,
	hasCurrentPanes,
	setAppearance,
	setShowSettings,
	showSettings,
	agentGrid,
	themeId,
}: AgentMainSurfaceProps) {
	return (
		<div {...stylex.props(styles.appRoot, styles.fullHeight)}>
			<div {...stylex.props(styles.appFrame)}>
				<div {...stylex.props(styles.appColumn)}>
					<div {...stylex.props(styles.appBody)}>
						<div {...stylex.props(styles.mainPane)}>
							{!hasCurrentPanes ? (
								<div {...stylex.props(styles.emptyWorkspace)} />
							) : (
								<div
									{...stylex.props(
										styles.surfaceLayer,
										styles.surfaceLayerVisible,
									)}
								>
									<div
										{...stylex.props(
											styles.repositoryWorkbench,
											chatZenMode && styles.chatWorkspaceZen,
										)}
									>
										<div
											{...stylex.props(
												styles.chatDock,
												chatZenMode && styles.chatDockZen,
											)}
										>
											{agentGrid}
										</div>
										{chatDiffPanel}
										{chatSidebar}
									</div>
								</div>
							)}
							{showSettings && (
								<Suspense fallback={null}>
									<Settings
										themeId={themeId}
										onThemeChange={(v: ThemeId) =>
											setAppearance((prev) => ({ ...prev, themeId: v }))
										}
										onClose={setShowSettings.bind(null, false)}
									/>
								</Suspense>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
