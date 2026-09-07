import { Dynamic } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { ariaValue } from "../../../../shared/lib/dom.tsx";
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
export function ViewerHeader(_props: ViewerHeaderProps) {
	return (
		<header {...stylex.attrs(styles.viewerHeader, styles.viewerHeaderFloating)}>
			{_props.mainViewMode === "graph" && _props.drag ? (
				<WorkspaceDockHandle {..._props.drag} />
			) : null}
			{_props.mainViewMode === "diff" && _props.file ? (
				<DiffFilePath path={_props.file.path} />
			) : null}
			{_props.mainViewMode === "diff" &&
			(_props.stats.added > 0 || _props.stats.removed > 0) ? (
				<span {...stylex.attrs(styles.viewerStats)}>
					{_props.stats.added > 0 ? (
						<span {...stylex.attrs(styles.viewerAdded)}>
							+{_props.stats.added}
						</span>
					) : null}
					{_props.stats.removed > 0 ? (
						<span {...stylex.attrs(styles.viewerRemoved)}>
							-{_props.stats.removed}
						</span>
					) : null}
				</span>
			) : null}
			{_props.mainViewMode === "graph" ? (
				<div {...stylex.attrs(styles.graphSyncActions)}>
					{(["fetch", "pull", "push"] as const).map((action) => {
						const ActionIcon = createMemo(() =>
							action === "fetch" ? IconRefreshCw : IconArrowDown,
						);
						const label = `${action[0]!.toLocaleUpperCase()}${action.slice(1)} repository`;
						const actionName = `${action[0]!.toLocaleUpperCase()}${action.slice(1)}`;
						return (
							<button
								type="button"
								disabled={_props.graphActionRunning}
								onClick={() =>
									_props.requestGraphAction({
										action,
										itemId: "repository",
									})
								}
								title={label}
								aria-label={ariaValue(label)}
								{...stylex.attrs(styles.graphSyncButton)}
							>
								<Dynamic
									component={ActionIcon()}
									size={iconSize.compact}
									{...stylex.attrs(action === "push" && styles.graphPushIcon)}
								/>
								<span>{actionName}</span>
							</button>
						);
					})}
				</div>
			) : null}
			{_props.mainViewMode !== "graph" ? (
				<>
					<span {...stylex.attrs(styles.viewerFloatingDivider)} />
					<div
						{...stylex.attrs(styles.viewerModes)}
						onMouseLeave={() => _props.setHoveredModeIndex(null)}
					>
						<LiquidSegmentedRail
							activeIndex={_props.hoveredModeIndex ?? _props.activeModeIndex}
							itemCount={3}
							radius={4}
						/>
						<button
							type="button"
							onMouseEnter={() => _props.setHoveredModeIndex(0)}
							onPointerDown={(event) => {
								if (event.button === 0 && event.isPrimary) {
									_props.onMainViewModeChange("diff");
									_props.onViewModeChange("split");
								}
							}}
							onClick={(event) => {
								if (event.detail === 0) {
									_props.onMainViewModeChange("diff");
									_props.onViewModeChange("split");
								}
							}}
							title="Full file diff"
							aria-label="Full file diff"
							{...stylex.attrs(
								styles.viewerModeButton,
								_props.viewMode === "split" && styles.viewerModeButtonActive,
							)}
						>
							<IconLayoutGrid size={iconSize.compact} />
						</button>
						<button
							type="button"
							onMouseEnter={() => _props.setHoveredModeIndex(1)}
							onPointerDown={(event) => {
								if (event.button === 0 && event.isPrimary) {
									_props.onMainViewModeChange("diff");
									_props.onViewModeChange("hunks");
								}
							}}
							onClick={(event) => {
								if (event.detail === 0) {
									_props.onMainViewModeChange("diff");
									_props.onViewModeChange("hunks");
								}
							}}
							title="Hunk view"
							aria-label="Hunk view"
							{...stylex.attrs(
								styles.viewerModeButton,
								_props.viewMode === "hunks" && styles.viewerModeButtonActive,
							)}
						>
							<IconGitBranch size={iconSize.compact} />
						</button>
						<button
							type="button"
							onMouseEnter={() => _props.setHoveredModeIndex(2)}
							onPointerDown={(event) => {
								if (event.button === 0 && event.isPrimary)
									_props.onToggleZenMode();
							}}
							onClick={(event) => {
								if (event.detail === 0) _props.onToggleZenMode();
							}}
							title={_props.zenMode ? "Exit focus mode" : "Focus workspace"}
							aria-label={ariaValue(
								_props.zenMode ? "Exit focus mode" : "Focus workspace",
							)}
							{...stylex.attrs(
								styles.viewerModeButton,
								_props.zenMode && styles.viewerModeButtonActive,
							)}
						>
							{_props.zenMode ? (
								<IconCollapse size={iconSize.compact} />
							) : (
								<IconExpand size={iconSize.compact} />
							)}
						</button>
					</div>
				</>
			) : null}
			{_props.mainViewMode !== "graph" ? (
				<button
					type="button"
					onPointerDown={(event) => {
						if (event.button === 0 && event.isPrimary) _props.onClose();
					}}
					onClick={(event) => {
						if (event.detail === 0) _props.onClose();
					}}
					title={_props.closeLabel}
					aria-label={ariaValue(_props.closeLabel)}
					{...stylex.attrs(styles.viewerClose)}
				>
					<IconX size={iconSize.xs} />
				</button>
			) : null}
		</header>
	);
}
