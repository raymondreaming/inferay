import type {
	AutomationDefinition,
	IndexedAutomation,
	IndexedDefinition,
	IndexedPlugin,
	ProjectDefinition,
	ProjectWorkspace,
	ToolDefinition,
} from "@contracts";

export type ProjectFile<T> = IndexedDefinition<T> & { definition: T };
export type Project = ProjectFile<ProjectDefinition> & { directory: string };
export type ProjectTool = ProjectFile<ToolDefinition>;
export type ProjectAutomation = {
	file: ProjectFile<AutomationDefinition>;
} & Omit<IndexedAutomation, "file">;
export type ProjectPlugin = IndexedPlugin & { directory: string };
export function pluginName(plugin: ProjectPlugin): string {
	return (
		plugin.file.definition?.name ??
		plugin.file.sourcePath.split("/")[1] ??
		"Plugin"
	);
}

function defined<T>(file: IndexedDefinition<T>): file is ProjectFile<T> {
	return !!file.definition && !file.error;
}
export function projectWorkspaceView(workspace: ProjectWorkspace) {
	const { catalog, history, root, conversationProjects } = workspace;
	return {
		...catalog,
		...history,
		root,
		conversationProjects,
		repositoryBindings: catalog.repositoryPaths,
		repositoryPaths: Object.values(catalog.repositoryPaths),
		projects: catalog.projects.filter(defined).map(
			(file): Project => ({
				...file,
				directory: `${root}/projects/${file.definition.id}`,
			}),
		),
		resources: catalog.resources.filter(defined),
		tools: catalog.tools.filter(defined),
		skills: catalog.skills.filter(defined),
		automations: catalog.automations.filter(
			(automation): automation is ProjectAutomation =>
				!!automation.file.definition,
		),
		plugins: catalog.plugins.map(
			(plugin): ProjectPlugin => ({
				...plugin,
				directory: `${root}/projects/${plugin.file.projectId}/${plugin.file.sourcePath.replace(/\/plugin\.json$/, "")}`,
			}),
		),
	};
}
export type ProjectWorkspaceView = ReturnType<typeof projectWorkspaceView>;

export function editDefinition<T>(file: IndexedDefinition<T>, definition: T) {
	return {
		type: "saveDefinition" as const,
		projectId: file.projectId,
		path: file.sourcePath,
		content: JSON.stringify(definition, null, 2),
		expectedHash: file.sourceHash,
	};
}
