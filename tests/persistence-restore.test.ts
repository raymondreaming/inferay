import { describe, expect, test } from "bun:test";
import { shouldSyncClientStorageKey } from "../src/adapters/storage/keys.ts";

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
});

test("native acknowledgments preserve the latest click across all workspace readers", async () => {
	const workspace = await import(
		"../src/modules/workspace/model/workspace-model.ts"
	);
	const previousFetch = globalThis.fetch;
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const target = new EventTarget();
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: target,
	});
	const state = {
		groups: [
			{
				id: "g",
				name: "Main",
				panes: [
					{ id: "a", title: "A", agentKind: "codex", isClaude: false },
					{ id: "b", title: "B", agentKind: "codex", isClaude: false },
				],
				selectedPaneId: "a",
				columns: 1,
				rows: 1,
			},
		],
		selectedGroupId: "g",
		themeId: "default",
		fontSize: 13,
		fontFamily: "SF Mono",
		opacity: 1,
	};
	const responses: Array<(response: Response) => void> = [];
	globalThis.fetch = (async (input) => {
		if (String(input).includes("/initialize")) return Response.json({ state });
		return new Promise<Response>((resolve) => responses.push(resolve));
	}) as typeof fetch;
	const details: Array<{
		state?: typeof state;
		saved?: boolean;
		error?: string;
	}> = [];
	target.addEventListener("agent-shell-change", (event) =>
		details.push((event as CustomEvent).detail),
	);
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
	try {
		await workspace.initializeAgentState();
		const initialRead = workspace.loadCanonicalAgentState();
		expect(workspace.loadCanonicalAgentState()).toBe(initialRead);
		await settle();
		expect(responses).toHaveLength(1);
		responses.shift()!(Response.json(state));
		await initialRead;
		const first = workspace.mutateAgentWorkspaceState({
			type: "selectPane",
			groupId: "g",
			paneId: "a",
		});
		const second = workspace.mutateAgentWorkspaceState({
			type: "selectPane",
			groupId: "g",
			paneId: "b",
		});
		expect(workspace.loadAgentState()?.groups[0]?.selectedPaneId).toBe(
			"b" as never,
		);
		await settle();
		responses.shift()!(Response.json({ state }));
		const firstResult = await first;
		expect(firstResult?.groups[0]?.selectedPaneId).toBe("b" as never);
		expect(
			details.filter((detail) => detail.saved).at(-1)?.state?.groups[0]
				?.selectedPaneId,
		).toBe("b");
		await settle();
		const selected = {
			...state,
			groups: [{ ...state.groups[0]!, selectedPaneId: "b" }],
		};
		responses.shift()!(Response.json({ state: selected }));
		await second;
		expect(workspace.loadAgentState()?.groups[0]?.selectedPaneId).toBe(
			"b" as never,
		);
		const failed = workspace.mutateAgentWorkspaceState({
			type: "selectPane",
			groupId: "g",
			paneId: "a",
		});
		await settle();
		responses.shift()!(new Response("unavailable", { status: 500 }));
		expect(await failed).toBeNull();
		expect(workspace.loadAgentState()?.groups[0]?.selectedPaneId).toBe(
			"b" as never,
		);
		expect(details.at(-1)?.error).toBe("Workspace changes could not be saved.");
	} finally {
		globalThis.fetch = previousFetch;
		if (previousWindow)
			Object.defineProperty(globalThis, "window", previousWindow);
		else Reflect.deleteProperty(globalThis, "window");
	}
});
