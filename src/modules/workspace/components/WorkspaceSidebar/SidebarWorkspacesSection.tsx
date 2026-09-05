import * as stylex from "@octanejs/stylex";
import { useEffect, useRef, useState } from "octane";
import {
	readStoredValue,
	writeStoredValue,
} from "../../../../adapters/storage/stored-values.ts";
import {
	iconSize,
	runtimeColor,
	selectionAppearance,
} from "../../../../design-system/styles.stylex.ts";
import { LiquidPanel } from "../../../../shared/ui/gooey/LiquidPanel/index.tsx";
import { LiquidSegmentedRail } from "../../../../shared/ui/gooey/LiquidSegmentedRail/index.tsx";
import { IconButton } from "../../../../shared/ui/IconButton/index.tsx";
import {
	IconFolder,
	IconGitBranch,
	IconLayoutGrid,
	IconLayoutRows,
	IconMessageCircle,
	IconPanelLeft,
} from "../../../../shared/ui/Icons/index.tsx";
import { Explorer } from "../../../explorer/components/Explorer/index.tsx";
import { dispatchOpenActiveGitGraph } from "../../../workbench/model/workbench-model.ts";
import type { SidebarWorkspaceState } from "../../model/workspace-model.ts";
import { projectRepositoryWorkspaces } from "../../model/workspace-model.ts";
import { SidebarChatList } from "./SidebarChatList.tsx";
import { styles } from "./styles.ts";

const GRID_DIMENSIONS = [1, 2, 3, 4] as const;

export function SidebarWorkspacesSection({
	collapsed,
	workspaces,
	layoutMode,
	onUpdateLayoutMode,
	onUpdateGrid,
	onSelectPane,
	onExpandSidebar,
}: {
	collapsed: boolean;
	workspaces: SidebarWorkspaceState;
	layoutMode: "grid" | "rows";
	onUpdateLayoutMode: (mode: "grid" | "rows") => void;
	onUpdateGrid: (patch: { columns?: number; rows?: number }) => void;
	onSelectPane: (groupId: string, paneId: string) => void;
	onExpandSidebar: () => void;
}) {
	const workspaceSectionProps = stylex.props(styles.workspaceSection);
	const [sectionMode, setSectionMode] = useState<"chats" | "explorer">(() =>
		readStoredValue("workspace-sidebar-mode") === "explorer"
			? "explorer"
			: "chats",
	);
	const [gridMenuOpen, setGridMenuOpen] = useState(false);
	const [hoveredGridDimension, setHoveredGridDimension] = useState<{
		axis: "columns";
		value: number;
	} | null>(null);
	const gridMenuRef = useRef<HTMLDivElement | null>(null);
	const selectedGroup =
		workspaces.groups.find(
			(group) => group.id === workspaces.selectedGroupId,
		) ?? null;
	const repositoryProjection = projectRepositoryWorkspaces(
		workspaces.groups,
		workspaces.selectedGroupId,
	);
	const selectedCwd = repositoryProjection.activeWorkspace?.cwd;
	const projectCwds = selectedCwd ? [selectedCwd] : [];
	const selectSectionMode = (mode: "chats" | "explorer") => {
		setSectionMode(mode);
		writeStoredValue("workspace-sidebar-mode", mode);
	};
	useEffect(() => {
		if (!gridMenuOpen) return;
		const closeMenu = (event: MouseEvent) => {
			if (!gridMenuRef.current?.contains(event.target as Node)) {
				setGridMenuOpen(false);
			}
		};
		document.addEventListener("mousedown", closeMenu);
		return () => document.removeEventListener("mousedown", closeMenu);
	}, [gridMenuOpen]);

	return (
		<div className={workspaceSectionProps.className}>
			{!collapsed ? (
				<div {...stylex.props(styles.sidebarToolbar)}>
					<div {...stylex.props(styles.sidebarRepositoryActions)}>
						<button
							type="button"
							onClick={dispatchOpenActiveGitGraph}
							disabled={!selectedCwd}
							{...stylex.props(styles.sidebarRepositoryAction)}
							title="Open commit graph"
						>
							<IconGitBranch size={iconSize.sm} />
							<span>Graph</span>
						</button>
					</div>
					<div {...stylex.props(styles.sidebarModeTabs)}>
						<button
							type="button"
							onClick={() => selectSectionMode("chats")}
							aria-pressed={sectionMode === "chats"}
							{...stylex.props(
								styles.sidebarModeTab,
								...selectionAppearance("sidebar", sectionMode === "chats"),
							)}
						>
							<IconMessageCircle size={iconSize.sm} />
							Chats
						</button>
						<button
							type="button"
							onClick={() => selectSectionMode("explorer")}
							aria-pressed={sectionMode === "explorer"}
							{...stylex.props(
								styles.sidebarModeTab,
								...selectionAppearance("sidebar", sectionMode === "explorer"),
							)}
						>
							<IconFolder size={iconSize.sm} />
							Explorer
						</button>
					</div>
				</div>
			) : null}
			{sectionMode === "explorer" && !collapsed ? (
				<Explorer cwds={projectCwds} />
			) : (
				<div {...stylex.props(styles.workspaceListScroll)}>
					<div
						{...stylex.props(
							styles.workspaceSectionHeader,
							collapsed
								? styles.workspaceSectionHeaderCollapsed
								: styles.workspaceSectionHeaderOpen,
						)}
					>
						{collapsed ? (
							<IconButton
								type="button"
								onClick={onExpandSidebar}
								variant="ghost"
								size="md"
								className={stylex.props(styles.collapsedAddButton).className}
								title="Expand workspace sidebar"
							>
								<IconPanelLeft
									size={iconSize.lg}
									className={
										stylex.props(styles.noShrink, styles.flipHorizontal)
											.className
									}
								/>
							</IconButton>
						) : (
							<div
								ref={gridMenuRef}
								{...stylex.props(styles.workspaceLayoutControl)}
							>
								<LiquidSegmentedRail
									activeIndex={layoutMode === "grid" ? 0 : 1}
									itemCount={2}
									radius={14}
									itemSize={28}
									gap={4}
								/>
								<span {...stylex.props(styles.workspaceGridWrap)}>
									<button
										type="button"
										onClick={() => {
											onUpdateLayoutMode("grid");
											setGridMenuOpen((open) => !open);
										}}
										{...stylex.props(
											styles.workspaceLayoutButton,
											layoutMode === "grid"
												? styles.workspaceLayoutButtonActive
												: styles.workspaceLayoutButtonIdle,
										)}
										aria-label="Grid layout"
										aria-expanded={gridMenuOpen}
									>
										<IconLayoutGrid size={iconSize.lg} />
									</button>
									{gridMenuOpen && selectedGroup ? (
										<span {...stylex.props(styles.workspaceGridMenuAnchor)}>
											<LiquidPanel fill={runtimeColor.backgroundRaised}>
												<div {...stylex.props(styles.workspaceGridMenu)}>
													<span {...stylex.props(styles.workspaceGridMenuRow)}>
														<span
															{...stylex.props(styles.workspaceGridMenuLabel)}
														>
															Columns
														</span>
														<span
															{...stylex.props(styles.workspaceGridChoices)}
															onMouseLeave={() => setHoveredGridDimension(null)}
														>
															<LiquidSegmentedRail
																activeIndex={
																	(hoveredGridDimension?.axis === "columns"
																		? hoveredGridDimension.value
																		: selectedGroup.columns) - 1
																}
																itemCount={4}
																itemSize={24}
																gap={2}
																radius={12}
															/>
															{GRID_DIMENSIONS.map((value) => (
																<button
																	key={`columns-${value}`}
																	type="button"
																	onMouseEnter={() =>
																		setHoveredGridDimension({
																			axis: "columns",
																			value,
																		})
																	}
																	onClick={() => {
																		onUpdateLayoutMode("grid");
																		onUpdateGrid({ columns: value });
																	}}
																	{...stylex.props(
																		styles.workspaceGridChoice,
																		selectedGroup.columns === value
																			? styles.workspaceGridChoiceActive
																			: null,
																	)}
																>
																	{value}
																</button>
															))}
														</span>
													</span>
													<span {...stylex.props(styles.workspaceGridMenuHint)}>
														Drag pane dividers to fine-tune the layout.
													</span>
												</div>
											</LiquidPanel>
										</span>
									) : null}
								</span>
								<button
									type="button"
									onClick={() => {
										onUpdateLayoutMode("rows");
										setGridMenuOpen(false);
									}}
									{...stylex.props(
										styles.workspaceLayoutButton,
										layoutMode === "rows"
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
						workspaces={workspaces}
						onSelectPane={onSelectPane}
					/>
				</div>
			)}
		</div>
	);
}
