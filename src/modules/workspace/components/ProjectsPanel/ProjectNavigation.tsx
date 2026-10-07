import { FileChangeTotals } from "@repository/components/changes/components/ChangesPanel/FileChangeTotals.tsx";
import { useGitStatus } from "@repository/hooks/useGitStatus.tsx";
import { APP_REGION_NO_DRAG_CLASS, ariaValue } from "@shared/lib/dom.tsx";
import {
	IconChevronDown,
	IconChevronRight,
	IconCode,
	IconFileDiff,
	IconGitBranch,
	IconPlus,
	IconSparkles,
	IconWorkflow,
	IconWrench,
} from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For } from "solid-js";
import {
	openProjectRepository,
	projects,
	showProjectView,
} from "../../hooks/useProjects.tsx";
import { ProjectEditor } from "./ProjectEditor.tsx";
import { styles } from "./styles.ts";

export function ProjectNavigation() {
	const [expanded, setExpanded] = createSignal(true);
	const [editing, setEditing] = createSignal(false);
	const current = () =>
		projects.list().find((p) => p.id === projects.selectedId());
	const git = useGitStatus(
		() => projects.catalog()?.repositoryPaths ?? [],
		() => ({ enabled: expanded() }),
	);
	const totals = createMemo(
		() =>
			new Map(
				git.projects.map((repository) => [
					repository.cwd,
					{
						additions: repository.files.reduce(
							(sum, file) => sum + (file.additions ?? 0),
							0,
						),
						deletions: repository.files.reduce(
							(sum, file) => sum + (file.deletions ?? 0),
							0,
						),
					},
				]),
			),
	);
	const items = [
		{ view: "resources", label: "Resources", icon: IconWrench },
		{ view: "files", label: "Files", icon: IconFileDiff },
		{ view: "tools", label: "Tools", icon: IconCode },
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
					{items.map((item) => (
						<button
							type="button"
							{...stylex.attrs(
								styles.tab,
								styles.mainNavigationItem,
								projects.view() === item.view && styles.selectedTab,
							)}
							aria-current={projects.view() === item.view ? "page" : undefined}
							onClick={() => showProjectView(item.view)}
						>
							<item.icon size={15} />
							<span>{item.label}</span>
						</button>
					))}
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
											projects.view() === "code" &&
											projects.repositoryPath() === path()
												? "page"
												: undefined
										}
										{...stylex.attrs(
											styles.tab,
											projects.view() === "code" &&
												projects.repositoryPath() === path() &&
												styles.selectedTab,
										)}
										onClick={() => openProjectRepository(path())}
									>
										<IconGitBranch size={14} />
										<span {...stylex.attrs(styles.repositoryNavLabel)}>
											{path().split("/").at(-1)}
										</span>
										{totals().get(path()) ? (
											<FileChangeTotals
												additions={totals().get(path())!.additions}
												deletions={totals().get(path())!.deletions}
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
				<ProjectEditor project={current()} close={() => setEditing(false)} />
			) : null}
		</nav>
	);
}
