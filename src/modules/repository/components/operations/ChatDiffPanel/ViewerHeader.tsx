import type { DiffViewMode } from "@contracts";
import { iconSize } from "@design-system/styles.stylex.ts";
import { FileTypeIcon } from "@explorer/components/FileTypeIcon/index.tsx";
import type { SelectedFile } from "@repository/components/changes/components/ChangesPanel/index.tsx";
import type { useGitDiff } from "@repository/hooks/useGitDiff.tsx";
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
import type { useGitOperations } from "./useGitOperations.tsx";

export function ViewerHeader(props: {
	readonly mainViewMode: "diff" | "graph";
	readonly branch?: string;
	readonly file: SelectedFile | null;
	readonly diff: ReturnType<typeof useGitDiff>["diff"];
	readonly operations: ReturnType<typeof useGitOperations>;
	readonly onMainViewModeChange: (mode: "diff" | "graph") => void;
	readonly viewMode: DiffViewMode;
	readonly onViewModeChange: (mode: DiffViewMode) => void;
	readonly zenMode: boolean;
	readonly onToggleZenMode: () => void;
	readonly onClose: () => void;
	readonly closeLabel: string;
}) {
	const stats = () => props.diff?.metadata?.stats;
	return (
		<header {...stylex.attrs(styles.viewerHeader, styles.viewerHeaderTop)}>
			{props.mainViewMode === "graph" && (
				<span title={props.branch} {...stylex.attrs(styles.graphTitle)}>
					<IconGitBranch size={iconSize.compact} />
					{props.branch || "Commit graph"}
				</span>
			)}
			{props.mainViewMode === "diff" && props.file ? (
				<DiffFilePath path={props.file.path} />
			) : null}
			{props.mainViewMode === "diff" &&
			((stats()?.added ?? 0) > 0 || (stats()?.removed ?? 0) > 0) ? (
				<span {...stylex.attrs(styles.viewerStats)}>
					{(stats()?.added ?? 0) > 0 ? (
						<span {...stylex.attrs(styles.viewerAdded)}>
							+{stats()?.added ?? 0}
						</span>
					) : null}
					{(stats()?.removed ?? 0) > 0 ? (
						<span {...stylex.attrs(styles.viewerRemoved)}>
							-{stats()?.removed ?? 0}
						</span>
					) : null}
				</span>
			) : null}
			{props.mainViewMode === "graph" ? (
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
								disabled={props.operations.state.graphActionRunning}
								onClick={() =>
									props.operations.requestGraphAction({
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
			{props.mainViewMode !== "graph" ? (
				<>
					<span {...stylex.attrs(styles.viewerFloatingDivider)} />
					<div {...stylex.attrs(styles.viewerModes)}>
						{(["split", "hunks"] as const).map((mode) => {
							const select = () => {
								props.onMainViewModeChange("diff");
								props.onViewModeChange(mode);
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
										props.viewMode === mode && styles.viewerModeButtonActive,
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
				onClick={props.onToggleZenMode}
				title={
					props.zenMode
						? "Restore chats (Esc)"
						: props.mainViewMode === "graph"
							? "Expand commit graph"
							: "Expand diff"
				}
				aria-label={
					props.zenMode
						? "Restore chats"
						: props.mainViewMode === "graph"
							? "Expand commit graph"
							: "Expand diff"
				}
				aria-pressed={ariaValue(props.zenMode)}
				{...stylex.attrs(
					styles.viewerModeButton,
					props.zenMode && styles.viewerModeButtonActive,
				)}
			>
				{props.zenMode ? (
					<IconCollapse size={iconSize.compact} />
				) : (
					<IconExpand size={iconSize.compact} />
				)}
			</button>
			{props.mainViewMode !== "graph" ? (
				<button
					type="button"
					onPointerDown={(event) => {
						if (event.button === 0 && event.isPrimary) props.onClose();
					}}
					onClick={(event) => {
						if (event.detail === 0) props.onClose();
					}}
					title={props.closeLabel}
					aria-label={ariaValue(props.closeLabel)}
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
