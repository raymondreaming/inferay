import type { RepositoryTabsTarget, RepositoryWorkspace } from "@contracts";
import { iconSize, selectionAppearance } from "@design-system/styles.stylex.ts";
import { FileChangeTotals } from "@repository/components/changes/components/ChangesPanel/FileChangeTotals.tsx";
import { useGitStatus } from "@repository/hooks/useGitStatus.tsx";
import {
	APP_REGION_NO_DRAG_CLASS,
	ariaValue,
	dispatchRemoveAgentPaneRequest,
	repositoryKeyboardInput,
} from "@shared/lib/dom.tsx";
import { project } from "@shared/lib/native.tsx";
import { IconGitBranch, IconX } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, For, onSettled } from "solid-js";
import { styles } from "./styles.ts";

type RepositoryTabDragController = {
	ordered: () => RepositoryWorkspace[];
	dragging: () => string | null;
	target: () => RepositoryTabsTarget | null;
	setContainer: (element: HTMLDivElement) => void;
	consumeClick: (event: MouseEvent) => boolean;
	onPointerDown: (event: PointerEvent, cwd: string) => void;
	onKeyDown: (event: KeyboardEvent, cwd: string) => void;
};

/** Renders and coordinates repository tabs against the drag controller's small interface. */
export function RepositoryWorkspaceTabs(props: {
	activePath: string | null;
	hasWorkspaces: boolean;
	onActivate: (workspace: RepositoryWorkspace) => void;
	tabDrag: RepositoryTabDragController;
}) {
	const status = useGitStatus(
		() => props.tabDrag.ordered().map((workspace) => workspace.cwd),
		() => ({ enabled: props.hasWorkspaces }),
	);
	let tabList: HTMLDivElement | undefined;
	const activateAdjacent = (direction: -1 | 1, event: KeyboardEvent) => {
		event.preventDefault();
		event.stopPropagation();
		const tabs = props.tabDrag.ordered();
		if (tabs.length < 2) return;
		const index = tabs.findIndex((tab) => tab.cwd === props.activePath);
		const next =
			tabs[
				index < 0
					? direction === 1
						? 0
						: tabs.length - 1
					: (index + direction + tabs.length) % tabs.length
			];
		if (!next) return;
		props.onActivate(next);
		tabList
			?.querySelectorAll<HTMLElement>('[role="tab"]')
			[tabs.indexOf(next)]?.focus({ preventScroll: true });
	};
	onSettled(() => {
		const cycle = (event: KeyboardEvent) => {
			const target = event.target;
			const tabTarget =
				target instanceof HTMLElement &&
				tabList?.contains(target) &&
				target.closest('[role="tab"]');
			const action = project<string | null>("repositoryShortcut", {
				...repositoryKeyboardInput(event),
				scope: tabTarget ? "repositoryTabs" : "window",
			});
			if (action === "previousRepository" || action === "nextRepository")
				activateAdjacent(action === "previousRepository" ? -1 : 1, event);
		};
		window.addEventListener("keydown", cycle, true);
		return () => window.removeEventListener("keydown", cycle, true);
	});
	const tabsProps = stylex.attrs(styles.tabs);
	return (
		<div
			ref={(element) => {
				tabList = element;
				props.tabDrag.setContainer(element);
			}}
			{...tabsProps}
			class={`${APP_REGION_NO_DRAG_CLASS} ${tabsProps.class ?? ""}`}
			role="tablist"
			aria-label="Repository workspaces"
		>
			{props.hasWorkspaces ? (
				<For each={props.tabDrag.ordered()} keyed={(row) => row.cwd}>
					{(workspace) => {
						const active = createMemo(
							() => workspace().cwd === props.activePath,
						);
						const totals = createMemo(() => {
							const groups = status.projectMap.get(workspace().cwd)?.fileGroups;
							return groups
								? project<{ additions: number; deletions: number }>(
										"changesPanel",
										{
											content: "workingTree",
											...groups,
										},
									)
								: null;
						});
						return (
							<div
								role="tab"
								tabindex={0}
								aria-selected={ariaValue(active())}
								data-repository-tab={workspace().cwd}
								title={`${workspace().cwd}\nDrag to reorder · Alt+Shift+Arrow keys to move`}
								aria-keyshortcuts="Tab Shift+Tab Meta+ArrowLeft Meta+ArrowRight Alt+Shift+ArrowLeft Alt+Shift+ArrowRight"
								onPointerDown={(event) => {
									event.currentTarget.focus({ preventScroll: true });
									props.tabDrag.onPointerDown(event, workspace().cwd);
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										props.onActivate(workspace());
									}
									props.tabDrag.onKeyDown(event, workspace().cwd);
								}}
								onClick={(event) => {
									if (!props.tabDrag.consumeClick(event))
										props.onActivate(workspace());
								}}
								{...stylex.attrs(
									...selectionAppearance("repository", active()),
									styles.tab,
									props.tabDrag.dragging() === workspace().cwd &&
										styles.draggingTab,
									props.tabDrag.target()?.before === workspace().cwd &&
										styles.dropBefore,
									props.tabDrag.target()?.before === null &&
										props.tabDrag.ordered().at(-1)?.cwd === workspace().cwd &&
										styles.dropAfter,
								)}
							>
								<IconGitBranch size={iconSize.sm} />
								<span {...stylex.attrs(styles.tabLabel)}>
									{workspace().name}
								</span>
								{((totals()?.additions ?? 0) > 0 ||
									(totals()?.deletions ?? 0) > 0) && (
									<FileChangeTotals
										additions={totals()!.additions}
										deletions={totals()!.deletions}
									/>
								)}
								<button
									type="button"
									aria-label={`Close ${workspace().name} and all its chats`}
									title="Close workspace and all its chats"
									onPointerDown={(event) => event.stopPropagation()}
									onKeyDown={(event) => {
										if (event.key !== "Tab") event.stopPropagation();
									}}
									onClick={(event) => {
										event.stopPropagation();
										for (const entry of workspace().entries)
											dispatchRemoveAgentPaneRequest(entry.pane.id);
									}}
									{...stylex.attrs(styles.closeTab)}
								>
									<IconX size={iconSize.xs} />
								</button>
							</div>
						);
					}}
				</For>
			) : (
				<span {...stylex.attrs(styles.emptyLabel)}>No repository open</span>
			)}
		</div>
	);
}
