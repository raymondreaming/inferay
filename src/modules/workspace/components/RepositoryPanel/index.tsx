import { iconSize, surfaceStyles } from "@design-system/styles.stylex.ts";
import { useRepositoryWorkbench } from "@repository/hooks/useRepositoryWorkbench.tsx";
import {
	ariaValue,
	createPointerResize,
	dispatchOpenActiveGitGraph,
	dispatchToggleActiveGitSidebar,
} from "@shared/lib/dom.tsx";
import {
	project,
	readStoredValue,
	writeStoredValue,
} from "@shared/lib/native.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { DropdownButton } from "@shared/ui/DropdownButton/index.tsx";
import { IconButton } from "@shared/ui/IconButton/index.tsx";
import {
	IconCollapse,
	IconExpand,
	IconFolder,
	IconGitBranch,
} from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onSettled,
	Show,
} from "solid-js";
import { openProjectRepository, projects } from "../../hooks/useProjects.tsx";
import { styles } from "./styles.ts";

export function RepositoryPanel() {
	const [expanded, setExpanded] = createSignal(false);
	const [available, setAvailable] = createSignal(1000);
	const [contentHeight, setContentHeight] = createSignal(600);
	const [preferredHeight, setPreferredHeight] = createSignal<
		string | number | null
	>(readStoredValue("inferay-repository-changes-height"));
	const changesLayout = createMemo(() =>
		project<{ height: number; minimum: number; maximum: number }>(
			"repositoryChangesLayout",
			{
				height: preferredHeight(),
				availableHeight: contentHeight(),
			},
		),
	);
	const saveHeight = (height: number) => {
		setPreferredHeight(height);
		writeStoredValue("inferay-repository-changes-height", String(height));
	};
	const [preferredWidth, setPreferredWidth] = createSignal<
		string | number | null
	>(readStoredValue("inferay-repository-panel-width"));
	const width = createMemo(() =>
		project<number>("repositoryResize", {
			width: preferredWidth(),
			availableWidth: available(),
		}),
	);
	const maximum = () =>
		project<number>("repositoryResize", {
			width: available(),
			availableWidth: available(),
		});
	const current = () =>
		projects.list().find((p) => p.id === projects.selectedId());
	const repositories = createMemo(
		() =>
			current()?.definition.repositories.flatMap((repo) => {
				const path = projects.catalog()?.repositoryBindings[repo.id];
				return path ? [{ id: path, label: repo.name, status: path }] : [];
			}) ?? [],
	);
	const path = () =>
		repositories().some((repo) => repo.id === projects.repositoryPath())
			? projects.repositoryPath()
			: null;
	let panel!: HTMLElement;
	// Expanding overlays the workspace without remeasuring or remounting chats.
	createEffect(expanded, (value) => {
		if (!value) return;
		const chat = panel.parentElement?.previousElementSibling;
		if (!(chat instanceof HTMLElement)) return;
		chat.inert = true;
		chat.style.visibility = "hidden";
		return () => {
			chat.inert = false;
			chat.style.visibility = "";
		};
	});
	const trackResize = createPointerResize();
	const saveWidth = (value: number) => {
		setPreferredWidth(value);
		writeStoredValue("inferay-repository-panel-width", String(value));
	};
	onSettled(() => {
		const parent = panel.parentElement!.parentElement!;
		const observer = new ResizeObserver(() => setAvailable(parent.clientWidth));
		setAvailable(parent.clientWidth);
		observer.observe(parent);
		const escape = (event: KeyboardEvent) => {
			if (
				event.key !== "Escape" ||
				event.defaultPrevented ||
				!expanded() ||
				document.querySelector("dialog[open], [popover]:popover-open")
			)
				return;
			event.preventDefault();
			setExpanded(false);
		};
		window.addEventListener("keydown", escape);
		return () => {
			observer.disconnect();
			window.removeEventListener("keydown", escape);
		};
	});
	return (
		<div {...stylex.attrs(styles.slot)} style={{ width: `${width()}px` }}>
			<aside
				id="project-repository-panel"
				aria-label="Project repository panel"
				ref={(element) => {
					panel = element;
				}}
				{...stylex.attrs(styles.panel, expanded() && styles.expanded)}
			>
				{!expanded() ? (
					<div
						role="separator"
						tabindex={0}
						aria-label="Resize repository panel"
						aria-orientation="vertical"
						aria-valuemin={Math.min(360, maximum())}
						aria-valuemax={maximum()}
						aria-valuenow={Math.round(width())}
						{...stylex.attrs(styles.resizeHandle)}
						onKeyDown={(event) => {
							if (
								!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
							)
								return;
							event.preventDefault();
							event.stopPropagation();
							saveWidth(
								project<number>("repositoryResize", {
									width:
										event.key === "Home"
											? 360
											: event.key === "End"
												? available()
												: width() + (event.key === "ArrowLeft" ? 32 : -32),
									availableWidth: available(),
								}),
							);
						}}
						onPointerDown={(event) => {
							if (event.button !== 0) return;
							event.preventDefault();
							event.currentTarget.focus({ preventScroll: true });
							const startX = event.clientX;
							const startWidth = width();
							let next = startWidth;
							trackResize(
								event.pointerId,
								(move) => {
									next = project<number>("repositoryResize", {
										width: startWidth + startX - move.clientX,
										availableWidth: available(),
									});
									setPreferredWidth(next);
								},
								() => saveWidth(next),
							);
						}}
					/>
				) : null}
				<Show
					when={path()}
					keyed
					fallback={
						<div {...stylex.attrs(styles.empty)}>
							<IconGitBranch size={24} />
							<p>
								{!projects.catalog()
									? "Loading repositories…"
									: current()?.definition.repositories.length
										? "Use Manage repositories in the left sidebar to link a local folder."
										: "Use Manage repositories in the left sidebar to add a repository."}
							</p>
						</div>
					}
				>
					{(repositoryPath) => {
						const workbench = useRepositoryWorkbench(() => repositoryPath);
						let content!: HTMLDivElement;
						onSettled(() => {
							const observer = new ResizeObserver(() =>
								setContentHeight(content.clientHeight),
							);
							setContentHeight(content.clientHeight);
							observer.observe(content);
							return () => observer.disconnect();
						});
						return (
							<>
								<header {...stylex.attrs(styles.header)}>
									<div {...stylex.attrs(styles.repositoryPicker)}>
										<DropdownButton
											label="Select repository"
											value={path()}
											options={repositories()}
											maxVisibleOptions={10}
											onChange={openProjectRepository}
											placeholder="Repositories"
											icon={<IconFolder size={iconSize.sm} />}
											variant="ghost"
											size="sm"
											fullWidth
										/>
									</div>
									{workbench.toolbar}
									<div
										role="group"
										aria-label="Repository views"
										{...stylex.attrs(styles.views)}
									>
										<Button
											variant="text"
											size="xs"
											aria-pressed={ariaValue(workbench.graphVisible())}
											onClick={dispatchOpenActiveGitGraph}
										>
											History
										</Button>
										<Button
											variant="text"
											size="xs"
											aria-pressed={ariaValue(workbench.sidebarVisible())}
											onClick={dispatchToggleActiveGitSidebar}
										>
											Changes
										</Button>
									</div>
									<IconButton
										aria-label={
											expanded()
												? "Restore chat beside repository"
												: "Expand repository panel"
										}
										title={
											expanded()
												? "Restore chat (Esc)"
												: "Expand repository panel"
										}
										aria-pressed={ariaValue(expanded())}
										onClick={() => setExpanded((value) => !value)}
									>
										{expanded() ? (
											<IconCollapse size={iconSize.sm} />
										) : (
											<IconExpand size={iconSize.sm} />
										)}
									</IconButton>
								</header>
								{workbench.error() ? (
									<div
										role="alert"
										{...stylex.attrs(surfaceStyles.errorNotice)}
									>
										{workbench.error()}
									</div>
								) : null}
								<div
									ref={(element) => {
										content = element;
									}}
									{...stylex.attrs(styles.workbench)}
								>
									<div
										{...stylex.attrs(
											styles.viewer,
											workbench.auxiliaryPanels.length > 0 && styles.hidden,
										)}
									>
										{workbench.diffPanel}
									</div>
									<For
										each={workbench.auxiliaryPanels}
										keyed={(value) => value.id}
									>
										{(value) => (
											<div
												{...stylex.attrs(styles.viewer)}
												onPointerDown={value().onSelect}
											>
												{value().render()}
											</div>
										)}
									</For>
									{workbench.sidebarVisible() ? (
										<div
											{...stylex.attrs(styles.changes)}
											style={{ height: `${changesLayout().height}px` }}
										>
											<div
												role="separator"
												tabindex={0}
												aria-label="Resize changes area"
												aria-orientation="horizontal"
												aria-valuemin={Math.round(changesLayout().minimum)}
												aria-valuemax={Math.round(changesLayout().maximum)}
												aria-valuenow={Math.round(changesLayout().height)}
												{...stylex.attrs(styles.changesResizeHandle)}
												onKeyDown={(event) => {
													if (
														!["ArrowUp", "ArrowDown", "Home", "End"].includes(
															event.key,
														)
													)
														return;
													event.preventDefault();
													event.stopPropagation();
													saveHeight(
														project<{ height: number }>(
															"repositoryChangesLayout",
															{
																availableHeight: contentHeight(),
																height:
																	event.key === "Home"
																		? changesLayout().minimum
																		: event.key === "End"
																			? changesLayout().maximum
																			: changesLayout().height +
																				(event.key === "ArrowUp" ? 32 : -32),
															},
														).height,
													);
												}}
												onPointerDown={(event) => {
													if (event.button !== 0) return;
													event.preventDefault();
													event.currentTarget.focus({ preventScroll: true });
													const startY = event.clientY;
													const startHeight = changesLayout().height;
													let next = startHeight;
													trackResize(
														event.pointerId,
														(move) => {
															next = project<{ height: number }>(
																"repositoryChangesLayout",
																{
																	height: startHeight + startY - move.clientY,
																	availableHeight: contentHeight(),
																},
															).height;
															setPreferredHeight(next);
														},
														() => saveHeight(next),
													);
												}}
											/>
											{workbench.sidebar}
										</div>
									) : null}
								</div>
								{workbench.operationFeedback}
							</>
						);
					}}
				</Show>
			</aside>
		</div>
	);
}
