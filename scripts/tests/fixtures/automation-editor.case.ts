import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { AutomationDefinition, ProjectFileCommand } from "@contracts";
import { createRoot, createSignal, createStore, flush } from "solid-js";
import {
	getAgentDefinition,
	project,
} from "../../../src/shared/lib/native.tsx";

// Exercise the editor's actual state and save path without rendering its controls.
const source = readFileSync(
	new URL(
		"../../../src/modules/workspace/components/ProjectsPanel/AutomationEditor.tsx",
		import.meta.url,
	),
	"utf8",
);
const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(
	source
		.slice(
			source.indexOf("export function AutomationEditor"),
			source.indexOf("\n\treturn (\n\t\t<form"),
		)
		.replace("export ", "") +
		"\nreturn { draft, edit, editExecution, switchExecution, setInput }; }",
);
const dependencies = {
	createSignal,
	createStore,
	project,
	getAgentDefinition,
	projects: { catalog: () => ({ tools: [] }) },
	useAutomationAutosave: () => ({}),
};
const create = new Function(
	...Object.keys(dependencies),
	`${code}; return AutomationEditor;`,
)(...Object.values(dependencies));

test("editing preserves unexposed fields, trigger semantics, and both execution drafts", () => {
	createRoot((dispose) => {
		try {
			const original: AutomationDefinition = {
				schema: "inferay.automation/1",
				id: "job",
				name: "Original",
				archived: true,
				may: ["network"],
				overlap: "queue_one",
				trigger: {
					kind: "calendar",
					timezone: "America/New_York",
					days: [2, 4],
					times: ["09:00", "16:30"],
				},
				execution: {
					kind: "agent",
					provider: "codex",
					model: null,
					reasoningLevel: null,
					instructions: "Do the work",
					tools: [{ pluginId: "library", toolId: "check", required: true }],
					skills: ["missing-skill"],
					resources: ["hidden-resource"],
					repositories: ["one", "two"],
					workingDirectory: { base: "project", path: "subfolder" },
					timeoutSeconds: 901,
				},
			};
			const editor = create({
				projectId: "project",
				automation: {
					file: {
						definition: original,
						sourcePath: "automations/job/automation.json",
						sourceHash: "hash",
					},
				},
			});
			const saved = () =>
				JSON.parse(
					(
						editor.draft() as Extract<
							ProjectFileCommand,
							{ type: "saveDefinition" }
						>
					).content,
				);
			expect(saved()).toEqual(original);
			editor.edit({ name: "Changed" });
			flush();
			expect(saved()).toEqual({ ...original, name: "Changed" });
			editor.switchExecution("tool");
			flush();
			editor.editExecution({ tool: "run" });
			editor.setInput('{"key":42}');
			flush();
			expect(saved().execution).toEqual({
				kind: "tool",
				tool: "run",
				input: { key: 42 },
			});
			editor.switchExecution("agent");
			flush();
			expect(saved().execution).toEqual(original.execution);
			editor.switchExecution("tool");
			flush();
			expect(saved().execution).toEqual({
				kind: "tool",
				tool: "run",
				input: { key: 42 },
			});
			editor.edit({ trigger: { kind: "interval", seconds: 86400 } });
			flush();
			expect(saved().trigger).toEqual({ kind: "interval", seconds: 86400 });
			expect(original.name).toBe("Original");
		} finally {
			dispose();
		}
	});
});
