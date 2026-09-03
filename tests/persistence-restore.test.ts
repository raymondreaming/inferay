import { describe, expect, test } from "bun:test";
import { shouldSyncClientStorageKey } from "../src/adapters/storage/keys.ts";
import {
	createAgentPane,
	normalizeAgentState,
} from "../src/modules/workspace/workspace-model.ts";

describe("app persistence restore flow", () => {
	test("syncs the complete workspace layout through native storage", () => {
		expect(shouldSyncClientStorageKey("agent-workspace-dock:workspace-1")).toBe(
			true,
		);
		expect(
			shouldSyncClientStorageKey("agent-workspace-panels:workspace-1"),
		).toBe(true);
		expect(
			shouldSyncClientStorageKey(
				"agent-workspace-files:workspace-file-viewer:workspace-1",
			),
		).toBe(true);
	});

	test("normalizes stale selected workspace to the best recoverable group", () => {
		const realPane = {
			...createAgentPane("codex", "/Users/ray/Developer/inferay"),
			id: "real-pane" as never,
		};
		const stalePane = {
			...createAgentPane("codex", undefined, true),
			id: "blank-pane" as never,
		};
		const normalized = normalizeAgentState({
			groups: [
				{
					id: "blank-workspace",
					name: "Blank",
					panes: [stalePane],
					selectedPaneId: stalePane.id,
					columns: 3,
					rows: 2,
				},
				{
					id: "real-workspace",
					name: "Real",
					panes: [realPane],
					selectedPaneId: realPane.id,
					columns: 3,
					rows: 2,
				},
			],
			selectedGroupId: "missing-workspace",
			themeId: "default",
			fontSize: 13,
			fontFamily: "SF Mono",
			opacity: 1,
		});

		expect(normalized?.selectedGroupId).toBe("real-workspace" as never);
		expect(normalized?.groups).toHaveLength(2);
		expect(normalized?.groups[1]?.panes[0]?.id).toBe("real-pane" as never);
	});
});
