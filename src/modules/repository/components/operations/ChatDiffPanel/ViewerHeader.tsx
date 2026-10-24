import type { DiffViewMode } from "@contracts";
import { iconSize } from "@design-system/styles.stylex.ts";
import { FileTypeIcon } from "@explorer/components/FileTypeIcon/index.tsx";
import type { SelectedFile } from "@repository/components/changes/components/ChangesPanel/index.tsx";
import type { GitGraphActionRequest } from "@repository/components/graph/components/CommitGraph/index.tsx";
import type { useGitDiff } from "@repository/hooks/useGitDiff.tsx";
import { ariaValue } from "@shared/lib/dom.tsx";
import { DropdownButton } from "@shared/ui/DropdownButton/index.tsx";
import {
	IconGitBranch,
	IconLayoutGrid,
	IconX,
} from "@shared/ui/Icons/index.tsx";
import { Dynamic } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import { styles } from "./styles.ts";
import type { useGitOperations } from "./useGitOperations.tsx";

export function ViewerHeader(props: {
	readonly mainViewMode: "diff" | "graph";
	readonly file: SelectedFile | null;
	readonly diff: ReturnType<typeof useGitDiff>["diff"];
	readonly onMainViewModeChange: (mode: "diff" | "graph") => void;
	readonly viewMode: DiffViewMode;
	readonly onViewModeChange: (mode: DiffViewMode) => void;
	readonly onClose: () => void;
	readonly closeLabel: string;
}) {
	const stats = () => props.diff?.metadata?.stats;
	return (
		<header {...stylex.attrs(styles.viewerHeader, styles.viewerHeaderTop)}>
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

export function RepositoryToolbar(props: {
	branch?: string;
	operations: ReturnType<typeof useGitOperations>;
	actions: Record<string, { title: string }>;
}) {
	const busy = () =>
		props.operations.state.graphActionRunning ||
		props.operations.state.refOperationRunning;
	const actions = createMemo(() =>
		(
			[
				"fetch",
				"pull",
				"push",
				"createBranch",
				"createTag",
				"stashPush",
				...(props.branch
					? ([
							"renameBranch",
							"setUpstream",
							"pushSetUpstream",
							"forcePushWithLease",
						] as const)
					: []),
			] as const
		).map((action) => ({
			id: action,
			label: props.actions[action]?.title ?? action,
		})),
	);
	return (
		<>
			<span title={props.branch} {...stylex.attrs(styles.graphTitle)}>
				<IconGitBranch size={iconSize.compact} />
				<span {...stylex.attrs(styles.branchName)}>
					{props.branch || "No branch"}
				</span>
			</span>

			<DropdownButton
				label="Repository actions"
				placeholder="Actions"
				value={null}
				variant="ghost"
				size="sm"
				disabled={busy()}
				options={actions()}
				onChange={(action) =>
					props.operations.requestGraphAction({
						action: action as GitGraphActionRequest["action"],
						itemId: "repository",
						target: ["fetch", "pull", "push", "stashPush"].includes(action)
							? undefined
							: props.branch || "HEAD",
					})
				}
			/>
		</>
	);
}
