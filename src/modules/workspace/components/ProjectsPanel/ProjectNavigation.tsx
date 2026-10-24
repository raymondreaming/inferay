import { selectionAppearance } from "@design-system/styles.stylex.ts";
import { FileChangeTotals } from "@repository/components/changes/components/ChangesPanel/FileChangeTotals.tsx";
import { useGitSummaries } from "@repository/hooks/useGitStatus.tsx";
import { APP_REGION_NO_DRAG_CLASS, ariaValue } from "@shared/lib/dom.tsx";
import {
	IconBookmark,
	IconChevronDown,
	IconChevronRight,
	IconGitBranch,
	IconPlus,
	IconSparkles,
	IconWorkflow,
} from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, For } from "solid-js";
import {
	openProjectRepository,
	projects,
	showProjectView,
} from "../../hooks/useProjects.tsx";
import { RepositoryManager } from "./RepositoryManager.tsx";
import { styles } from "./styles.ts";

export function ProjectNavigation() {
	const [expanded, setExpanded] = createSignal(true);
	const [editing, setEditing] = createSignal(false);
	const current = () =>
		projects.list().find((p) => p.id === projects.selectedId());
	const git = useGitSummaries(
		() => projects.catalog()?.repositoryPaths ?? [],
		() => expanded(),
	);
	const items = [
		{ view: "memory", label: "Memory", icon: IconBookmark },
		{ view: "plugins", label: "Plugins", icon: IconSparkles },
		{ view: "automations", label: "Automations", icon: IconWorkflow },
	];
	return (
		<nav
			aria-label="Project navigation"
			class={`${APP_REGION_NO_DRAG_CLASS} ${stylex.attrs(styles.navigation).class ?? ""}`}
		>
			{projects.selectedId() ? (
				<>
					<For each={items} keyed>
						{(item) => (
							<button
								type="button"
								{...stylex.attrs(
									styles.tab,
									styles.mainNavigationItem,
									...selectionAppearance(
										"navigation",
										projects.view() === item.view,
									),
								)}
								aria-current={
									projects.view() === item.view ? "page" : undefined
								}
								onClick={() => showProjectView(item.view)}
							>
								<item.icon size={15} />
								<span>{item.label}</span>
							</button>
						)}
					</For>
					<button
						type="button"
						aria-expanded={ariaValue(expanded())}
						aria-controls="project-repositories"
						{...stylex.attrs(styles.tab, styles.mainNavigationItem)}
						onClick={() => setExpanded((value) => !value)}
					>
						<IconGitBranch size={15} />
						<span {...stylex.attrs(styles.repositoryNavLabel)}>
							Repositories
						</span>
						{expanded() ? (
							<IconChevronDown size={13} />
						) : (
							<IconChevronRight size={13} />
						)}
					</button>
					{expanded() ? (
						<div
							id="project-repositories"
							{...stylex.attrs(styles.repositoryNavList)}
						>
							<For
								each={projects.catalog()?.repositoryPaths ?? []}
								keyed={(path) => path}
							>
								{(path) => (
									<button
										type="button"
										title={path()}
										aria-label={`Open repository ${path().split("/").at(-1)}`}
										aria-current={
											projects.repositoryOpen() &&
											projects.repositoryPath() === path()
												? "page"
												: undefined
										}
										{...stylex.attrs(
											styles.tab,
											...selectionAppearance(
												"navigation",
												projects.repositoryOpen() &&
													projects.repositoryPath() === path(),
											),
										)}
										onClick={() => openProjectRepository(path())}
									>
										<IconGitBranch size={14} />
										<span {...stylex.attrs(styles.repositoryNavLabel)}>
											{path().split("/").at(-1)}
										</span>
										{git()[path()] ? (
											<FileChangeTotals
												additions={git()[path()]!.additions}
												deletions={git()[path()]!.deletions}
											/>
										) : null}
									</button>
								)}
							</For>
							<button
								type="button"
								{...stylex.attrs(styles.tab)}
								onClick={() => setEditing(true)}
							>
								<IconPlus size={14} />
								<span>Manage repositories</span>
							</button>
						</div>
					) : null}
				</>
			) : null}
			{editing() && current() ? (
				<RepositoryManager
					project={current()!}
					close={() => setEditing(false)}
				/>
			) : null}
		</nav>
	);
}
