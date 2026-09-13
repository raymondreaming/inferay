import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal } from "solid-js";
import {
	iconSize,
	surfaceStyles,
} from "../../../../design-system/styles.stylex.ts";
import { ariaValue } from "../../../../shared/lib/dom.tsx";
import { IconButton } from "../../../../shared/ui/IconButton/index.tsx";
import {
	IconLayoutGrid,
	IconLayoutRows,
	IconPanelLeft,
} from "../../../../shared/ui/Icons/index.tsx";
import { Explorer } from "../../../explorer/components/Explorer/index.tsx";
import type { SidebarWorkspaceState } from "../../hooks/useWorkspaceState.tsx";
import { SidebarChatList } from "./SidebarChatList.tsx";
import { styles } from "./styles.ts";

const GRID_DIMENSIONS = [1, 2, 3, 4] as const;
export function SidebarWorkspacesSection(_props: {
	collapsed: boolean;
	workspaces: SidebarWorkspaceState;
	layoutMode: "grid" | "rows";
	onUpdateLayoutMode: (mode: "grid" | "rows") => void;
	onUpdateGrid: (patch: { columns?: number; rows?: number }) => void;
	onSelectPane: (groupId: string, paneId: string) => void;
	onExpandSidebar: () => void;
}) {
	const workspaceSectionProps = createMemo(() =>
		stylex.attrs(styles.workspaceSection),
	);
	const [gridMenuOpen, setGridMenuOpen] = createSignal(false);
	const gridMenuRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const selectedGroup = createMemo(
		() =>
			_props.workspaces.groups.find(
				(group) => group.id === _props.workspaces.selectedGroupId,
			) ?? null,
	);
	const selectedCwd = createMemo(
		() => _props.workspaces.repositories.activeWorkspace?.cwd,
	);
	const projectCwds = createMemo(() => {
		const _selectedCwdValue = selectedCwd();
		return _selectedCwdValue ? [_selectedCwdValue] : [];
	});
	createEffect(gridMenuOpen, (isOpen) => {
		if (!isOpen) return;
		const closeMenu = (event: MouseEvent) => {
			if (!gridMenuRef.current?.contains(event.target as Node)) {
				setGridMenuOpen(false);
			}
		};
		document.addEventListener("mousedown", closeMenu);
		return () => document.removeEventListener("mousedown", closeMenu);
	});
	return (
		<div class={workspaceSectionProps().class}>
			<div
				{...stylex.attrs(
					styles.workspaceListScroll,
					!_props.collapsed && styles.workspaceListScrollSplit,
				)}
			>
				<div
					{...stylex.attrs(
						styles.workspaceSectionHeader,
						_props.collapsed
							? styles.workspaceSectionHeaderCollapsed
							: styles.workspaceSectionHeaderOpen,
					)}
				>
					{_props.collapsed ? (
						<IconButton
							type="button"
							onClick={_props.onExpandSidebar}
							variant="ghost"
							size="md"
							class={stylex.attrs(styles.collapsedAddButton).class}
							title="Expand workspace sidebar"
						>
							<IconPanelLeft
								size={iconSize.lg}
								class={
									stylex.attrs(styles.noShrink, styles.flipHorizontal).class
								}
							/>
						</IconButton>
					) : (
						<div
							ref={(element) => (gridMenuRef.current = element)}
							{...stylex.attrs(styles.workspaceLayoutControl)}
						>
							<span {...stylex.attrs(styles.workspaceGridWrap)}>
								<button
									type="button"
									onClick={() => {
										_props.onUpdateLayoutMode("grid");
										setGridMenuOpen((open) => !open);
									}}
									{...stylex.attrs(
										styles.workspaceLayoutButton,
										_props.layoutMode === "grid"
											? styles.workspaceLayoutButtonActive
											: styles.workspaceLayoutButtonIdle,
									)}
									aria-label="Grid layout"
									aria-expanded={ariaValue(gridMenuOpen())}
								>
									<IconLayoutGrid size={iconSize.lg} />
								</button>
								{gridMenuOpen() && selectedGroup() ? (
									<span {...stylex.attrs(styles.workspaceGridMenuAnchor)}>
										<div
											{...stylex.attrs(
												surfaceStyles.overlay,
												styles.workspaceGridMenu,
											)}
										>
											<span {...stylex.attrs(styles.workspaceGridMenuRow)}>
												<span {...stylex.attrs(styles.workspaceGridMenuLabel)}>
													Columns
												</span>
												<span {...stylex.attrs(styles.workspaceGridChoices)}>
													{GRID_DIMENSIONS.map((value) => (
														<button
															type="button"
															onClick={() => {
																_props.onUpdateLayoutMode("grid");
																_props.onUpdateGrid({
																	columns: value,
																});
															}}
															{...stylex.attrs(
																styles.workspaceGridChoice,
																selectedGroup()?.columns === value
																	? styles.workspaceGridChoiceActive
																	: null,
															)}
														>
															{value}
														</button>
													))}
												</span>
											</span>
											<span {...stylex.attrs(styles.workspaceGridMenuHint)}>
												Drag pane dividers to fine-tune the layout.
											</span>
										</div>
									</span>
								) : null}
							</span>
							<button
								type="button"
								onClick={() => {
									_props.onUpdateLayoutMode("rows");
									setGridMenuOpen(false);
								}}
								{...stylex.attrs(
									styles.workspaceLayoutButton,
									_props.layoutMode === "rows"
										? styles.workspaceLayoutButtonActive
										: styles.workspaceLayoutButtonIdle,
								)}
								aria-label="Row layout"
							>
								<IconLayoutRows size={iconSize.lg} />
							</button>
						</div>
					)}
				</div>
				<SidebarChatList
					workspaces={_props.workspaces}
					onSelectPane={_props.onSelectPane}
				/>
			</div>
			{!_props.collapsed ? (
				<div {...stylex.attrs(styles.sidebarExplorerSection)}>
					<Explorer cwds={projectCwds()} />
				</div>
			) : null}
		</div>
	);
}
