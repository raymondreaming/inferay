import { expect, test } from "bun:test";
import type { ProjectWorkspace } from "@contracts";
import {
	pluginName,
	projectWorkspaceView,
} from "../../src/modules/workspace/model/projectFiles.ts";

test("invalid libraries remain visible and retain their file identity for repair", () => {
	const workspace: ProjectWorkspace = {
		root: "/profile",
		conversationProjects: {},
		history: {
			runs: [],
			artifacts: [],
			effects: [],
			hasMoreRuns: false,
			nextRunCursor: null,
		},
		catalog: {
			projects: [],
			resources: [],
			tools: [],
			skills: [],
			automations: [],
			issues: [],
			repositoryPaths: {},
			repositoryUsers: {},
			resourceChoices: [],
			skillChoices: [],
			toolChoices: [],
			plugins: [
				{
					file: {
						id: "invalid:manifest",
						projectId: "studio",
						pluginId: null,
						sourcePath: "plugins/blender-kit/plugin.json",
						sourceHash: "broken-hash",
						definition: null,
						error: "plugin.json: invalid JSON",
					},
					approvedHash: null,
					approvedAt: null,
					overview: {
						status: "Needs repair",
						schedulesActive: false,
						consumers: {},
						tools: [],
						issues: [],
						latestRunId: null,
					},
				},
			],
		},
	};
	const view = projectWorkspaceView(workspace);
	expect(view.plugins).toHaveLength(1);
	expect(pluginName(view.plugins[0])).toBe("blender-kit");
	expect(view.plugins[0].file.error).toBe("plugin.json: invalid JSON");
	expect(view.plugins[0].file.sourceHash).toBe("broken-hash");
	expect(view.plugins[0].directory).toBe(
		"/profile/projects/studio/plugins/blender-kit",
	);
});
