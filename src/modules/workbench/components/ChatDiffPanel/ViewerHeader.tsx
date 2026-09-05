import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../../design-system/styles.stylex.ts";

import { LiquidSegmentedRail } from "../../../../shared/ui/gooey/LiquidSegmentedRail/index.tsx";
import {
	IconArrowDown,
	IconCollapse,
	IconExpand,
	IconGitBranch,
	IconLayoutGrid,
	IconRefreshCw,
	IconX,
} from "../../../../shared/ui/Icons/index.tsx";
import { WorkspaceDockHandle } from "../WorkspaceDockHandle/index.tsx";
import { DiffFilePath } from "./DiffFilePath.tsx";
import { styles } from "./styles.ts";

import type { useChatDiffPanelState } from "./useChatDiffPanelState.tsx";

type ViewerHeaderProps = Pick<
	ReturnType<typeof useChatDiffPanelState>,
	| "mainViewMode"
	| "drag"
	| "file"
	| "stats"
	| "graphActionRunning"
	| "requestGraphAction"
	| "setHoveredModeIndex"
	| "hoveredModeIndex"
	| "activeModeIndex"
	| "onMainViewModeChange"
	| "onViewModeChange"
	| "viewMode"
	| "onToggleZenMode"
	| "zenMode"
	| "onClose"
	| "closeLabel"
>;
export function ViewerHeader({
	mainViewMode,
	drag,
	file,
	stats,
	graphActionRunning,
	requestGraphAction,
	setHoveredModeIndex,
	hoveredModeIndex,
	activeModeIndex,
	onMainViewModeChange,
	onViewModeChange,
	viewMode,
	onToggleZenMode,
	zenMode,
	onClose,
	closeLabel,
}: ViewerHeaderProps) {
	return (
		<header {...stylex.props(styles.viewerHeader, styles.viewerHeaderFloating)}>
			{mainViewMode === "graph" && drag ? (
				<WorkspaceDockHandle {...drag} />
			) : null}
			{mainViewMode === "diff" && file ? (
				<DiffFilePath path={file.path} />
			) : null}
			{mainViewMode === "diff" && (stats.added > 0 || stats.removed > 0) ? (
				<span {...stylex.props(styles.viewerStats)}>
					{stats.added > 0 ? (
						<span {...stylex.props(styles.viewerAdded)}>+{stats.added}</span>
					) : null}
					{stats.removed > 0 ? (
						<span {...stylex.props(styles.viewerRemoved)}>
							-{stats.removed}
						</span>
					) : null}
				</span>
			) : null}
			{mainViewMode === "graph" ? (
				<div {...stylex.props(styles.graphSyncActions)}>
					{(["fetch", "pull", "push"] as const).map((action) => {
						const ActionIcon =
							action === "fetch" ? IconRefreshCw : IconArrowDown;
						const label = `${action[0]!.toLocaleUpperCase()}${action.slice(1)} repository`;
						const actionName = `${action[0]!.toLocaleUpperCase()}${action.slice(1)}`;
						return (
							<button
								key={action}
								type="button"
								disabled={graphActionRunning}
								onClick={() =>
									requestGraphAction({ action, itemId: "repository" })
								}
								title={label}
								aria-label={label}
								{...stylex.props(styles.graphSyncButton)}
							>
								<ActionIcon
									size={iconSize.compact}
									{...stylex.props(action === "push" && styles.graphPushIcon)}
								/>
								<span>{actionName}</span>
							</button>
						);
					})}
				</div>
			) : null}
			{mainViewMode !== "graph" ? (
				<>
					<span {...stylex.props(styles.viewerFloatingDivider)} />
					<div
						{...stylex.props(styles.viewerModes)}
						onMouseLeave={() => setHoveredModeIndex(null)}
					>
						<LiquidSegmentedRail
							activeIndex={hoveredModeIndex ?? activeModeIndex}
							itemCount={3}
							radius={4}
						/>
						<button
							type="button"
							onMouseEnter={() => setHoveredModeIndex(0)}
							onPointerDown={(event) => {
								if (event.button === 0 && event.isPrimary) {
									onMainViewModeChange("diff");
									onViewModeChange("split");
								}
							}}
							onClick={(event) => {
								if (event.detail === 0) {
									onMainViewModeChange("diff");
									onViewModeChange("split");
								}
							}}
							title="Full file diff"
							aria-label="Full file diff"
							{...stylex.props(
								styles.viewerModeButton,
								viewMode === "split" && styles.viewerModeButtonActive,
							)}
						>
							<IconLayoutGrid size={iconSize.compact} />
						</button>
						<button
							type="button"
							onMouseEnter={() => setHoveredModeIndex(1)}
							onPointerDown={(event) => {
								if (event.button === 0 && event.isPrimary) {
									onMainViewModeChange("diff");
									onViewModeChange("hunks");
								}
							}}
							onClick={(event) => {
								if (event.detail === 0) {
									onMainViewModeChange("diff");
									onViewModeChange("hunks");
								}
							}}
							title="Hunk view"
							aria-label="Hunk view"
							{...stylex.props(
								styles.viewerModeButton,
								viewMode === "hunks" && styles.viewerModeButtonActive,
							)}
						>
							<IconGitBranch size={iconSize.compact} />
						</button>
						<button
							type="button"
							onMouseEnter={() => setHoveredModeIndex(2)}
							onPointerDown={(event) => {
								if (event.button === 0 && event.isPrimary) onToggleZenMode();
							}}
							onClick={(event) => {
								if (event.detail === 0) onToggleZenMode();
							}}
							title={zenMode ? "Exit focus mode" : "Focus workspace"}
							aria-label={zenMode ? "Exit focus mode" : "Focus workspace"}
							{...stylex.props(
								styles.viewerModeButton,
								zenMode && styles.viewerModeButtonActive,
							)}
						>
							{zenMode ? (
								<IconCollapse size={iconSize.compact} />
							) : (
								<IconExpand size={iconSize.compact} />
							)}
						</button>
					</div>
				</>
			) : null}
			{mainViewMode !== "graph" ? (
				<button
					type="button"
					onPointerDown={(event) => {
						if (event.button === 0 && event.isPrimary) onClose();
					}}
					onClick={(event) => {
						if (event.detail === 0) onClose();
					}}
					title={closeLabel}
					aria-label={closeLabel}
					{...stylex.props(styles.viewerClose)}
				>
					<IconX size={iconSize.xs} />
				</button>
			) : null}
		</header>
	);
}
