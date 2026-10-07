import type {
	AutomationDefinition,
	IndexedAutomation,
	IndexedDefinition,
	IndexedPlugin,
	ProjectDefinition,
	ProjectWorkspace,
	ResourceDefinition,
	ToolDefinition,
} from "@contracts";

// Renderer views retain their source file for conflict-safe edits. Invalid
// definitions retain their current parsed value so users can repair them.
export type ProjectFile<T> = T & { file: IndexedDefinition<T> };
export type Project = ProjectFile<ProjectDefinition> & { directory: string };
export type ProjectTool = ProjectFile<ToolDefinition>;
export type ProjectResource = ProjectFile<ResourceDefinition>;
export type ProjectAutomation = ProjectFile<AutomationDefinition> &
	Omit<IndexedAutomation, "file">;
export type ProjectPlugin = IndexedPlugin & { directory: string };
export function pluginName(plugin: ProjectPlugin): string {
	return (
		plugin.file.definition?.name ??
		plugin.file.sourcePath.split("/")[1] ??
		"Plugin"
	);
}

function defined<T>(file: IndexedDefinition<T>): ProjectFile<T>[] {
	return file.definition && !file.error ? [{ ...file.definition, file }] : [];
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
		projects: catalog.projects.flatMap((file): Project[] =>
			defined(file).map((project) => ({
				...project,
				directory: `${root}/projects/${project.id}`,
			})),
		),
		resources: catalog.resources.flatMap(defined),
		tools: catalog.tools.flatMap(defined),
		automations: catalog.automations.flatMap(
			({ file, ...state }): ProjectAutomation[] =>
				file.definition ? [{ ...file.definition, file, ...state }] : [],
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
