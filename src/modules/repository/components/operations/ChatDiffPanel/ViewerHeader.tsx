import { iconSize } from "@design-system/styles.stylex.ts";
import { FileTypeIcon } from "@explorer/components/FileTypeIcon/index.tsx";
import { ariaValue } from "@shared/lib/dom.tsx";
import {
	IconArrowDown,
	IconCollapse,
	IconExpand,
	IconGitBranch,
	IconLayoutGrid,
	IconRefreshCw,
	IconX,
} from "@shared/ui/Icons/index.tsx";
import { Dynamic } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import { styles } from "./styles.ts";
import type { useChatDiffPanelState } from "./useChatDiffPanelState.tsx";

export function ViewerHeader(
	_props: Pick<
		ReturnType<typeof useChatDiffPanelState>,
		| "mainViewMode"
		| "branch"
		| "file"
		| "stats"
		| "graphActionRunning"
		| "requestGraphAction"
		| "onMainViewModeChange"
		| "onViewModeChange"
		| "viewMode"
		| "onToggleZenMode"
		| "zenMode"
		| "onClose"
		| "closeLabel"
	>,
) {
	return (
		<header {...stylex.attrs(styles.viewerHeader, styles.viewerHeaderTop)}>
			{_props.mainViewMode === "graph" && (
				<span title={_props.branch} {...stylex.attrs(styles.graphTitle)}>
					<IconGitBranch size={iconSize.compact} />
					{_props.branch || "Commit graph"}
				</span>
			)}
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
					<div {...stylex.attrs(styles.viewerModes)}>
						{(["split", "hunks"] as const).map((mode) => {
							const select = () => {
								_props.onMainViewModeChange("diff");
								_props.onViewModeChange(mode);
							};
							const label = mode === "split" ? "Full file diff" : "Hunk view";
							return (
								<button
									type="button"
									onPointerDown={(event) => {
										if (event.button === 0 && event.isPrimary) select();
									}}
									onClick={(event) => {
										if (event.detail === 0) select();
									}}
									title={label}
									aria-label={label}
									{...stylex.attrs(
										styles.viewerModeButton,
										_props.viewMode === mode && styles.viewerModeButtonActive,
									)}
								>
									<Dynamic
										component={
											mode === "split" ? IconLayoutGrid : IconGitBranch
										}
										size={iconSize.compact}
									/>
								</button>
							);
						})}
					</div>
				</>
			) : null}
			<button
				type="button"
				onClick={_props.onToggleZenMode}
				title={
					_props.zenMode
						? "Restore chats (Esc)"
						: _props.mainViewMode === "graph"
							? "Expand commit graph"
							: "Expand diff"
				}
				aria-label={
					_props.zenMode
						? "Restore chats"
						: _props.mainViewMode === "graph"
							? "Expand commit graph"
							: "Expand diff"
				}
				aria-pressed={ariaValue(_props.zenMode)}
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

function DiffFilePath(_props: { readonly path: string }) {
	const separator = createMemo(() => _props.path.lastIndexOf("/"));
	return (
		<span title={_props.path} {...stylex.attrs(styles.viewerFloatingFile)}>
			<FileTypeIcon path={_props.path} size={iconSize.md} />
			<span {...stylex.attrs(styles.viewerFloatingPath)}>
				<span {...stylex.attrs(styles.viewerDirectory)}>
					{separator() >= 0 ? _props.path.slice(0, separator()) : ""}
				</span>
				<strong {...stylex.attrs(styles.viewerFileName)}>
					{_props.path.slice(Math.max(0, separator()))}
				</strong>
			</span>
		</span>
	);
}
