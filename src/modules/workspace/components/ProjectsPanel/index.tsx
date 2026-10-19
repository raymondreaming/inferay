import { Button } from "@shared/ui/Button/index.tsx";
import { IconFolder } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, onSettled, Show } from "solid-js";
import { projects, refreshProjects } from "../../hooks/useProjects.tsx";
import { AutomationWorkspace } from "./AutomationWorkspace.tsx";
import { MemoryGraph } from "./MemoryGraph/index.tsx";
import { PluginsPanel } from "./PluginsPanel.tsx";
import { ProjectEditor } from "./ProjectEditor.tsx";
import { styles } from "./styles.ts";

export function ProjectsPanel() {
	const [creatingProject, setCreatingProject] = createSignal(false);
	const current = () =>
		projects.catalog()?.projects.find((p) => p.id === projects.selectedId());
	onSettled(() => {
		const timer = setInterval(() => {
			if (!document.hidden && !projects.busy()) void refreshProjects();
		}, 3000);
		return () => clearInterval(timer);
	});

	return (
		<section
			aria-label="Project workspace"
			{...stylex.attrs(
				styles.main,
				(projects.view() === "automations" || projects.view() === "memory") &&
					styles.automationMain,
			)}
		>
			{projects.error() && projects.view() !== "automations" ? (
				<p role="alert">{projects.error()}</p>
			) : null}
			{creatingProject() ? (
				<ProjectEditor
					close={() => {
						setCreatingProject(false);
					}}
				/>
			) : null}
			{!current() ? (
				<div {...stylex.attrs(styles.list)}>
					{projects.catalog() &&
					!projects.list().some((p) => !p.definition.archived) ? (
						<div {...stylex.attrs(styles.empty)}>
							<IconFolder size={28} />
							<strong>A home for your next idea</strong>
							<p>
								Create a project to bring chats, memory, and automations
								together.
							</p>
							<Button size="sm" onClick={() => setCreatingProject(true)}>
								Create your first project
							</Button>
						</div>
					) : null}
				</div>
			) : null}
			<Show when={projects.view() === "memory" && current()?.id} keyed>
				{(id) => (
					<section
						aria-label="Project memory"
						{...stylex.attrs(styles.memoryPanel)}
					>
						<MemoryGraph projectId={id} />
					</section>
				)}
			</Show>
			{current() && projects.view() === "plugins" ? <PluginsPanel /> : null}
			{current() && projects.view() === "automations" ? (
				<AutomationWorkspace />
			) : null}
		</section>
	);
}
