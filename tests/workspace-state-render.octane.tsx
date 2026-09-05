import { JSDOM } from "jsdom";
import { createRoot } from "octane";
import { expect, test, vi } from "vitest";
import { useWorkspaceState } from "../src/modules/workspace/model/useWorkspaceState.ts";
import {
	type AgentSavedState,
	dispatchAgentShellChange,
} from "../src/modules/workspace/model/workspace-model.ts";

test("shared workspace reader restores failed optimistic changes and reports recovery", async () => {
	const dom = new JSDOM('<div id="root"></div>', {
		url: "http://localhost",
		pretendToBeVisual: true,
	});
	for (const name of [
		"window",
		"document",
		"Node",
		"Element",
		"HTMLElement",
		"CustomEvent",
		"MutationObserver",
		"localStorage",
	] as const) {
		Object.defineProperty(globalThis, name, {
			configurable: true,
			value: name === "window" ? dom.window : dom.window[name],
		});
	}
	const element = dom.window.document.getElementById("root")!;
	const root = createRoot(element);
	const listen = vi.spyOn(dom.window, "addEventListener");
	const saved = {
		groups: [
			{
				id: "g",
				name: "Saved",
				panes: [],
				selectedPaneId: null,
				columns: 1,
				rows: 1,
			},
		],
		selectedGroupId: "g",
		themeId: "default",
		fontFamily: "SF Mono",
		fontSize: 13,
		opacity: 1,
	} as AgentSavedState;
	function Probe() {
		const [state, setState, error] = useWorkspaceState(false, false);
		return (
			<button
				type="button"
				onClick={() =>
					setState((current) => ({
						...current,
						groups: current.groups.map((group) => ({
							...group,
							name: "Optimistic",
						})),
					}))
				}
			>
				{state.groups[0]?.name}:{error ?? "ok"}
			</button>
		);
	}
	try {
		root.render(<Probe />);
		await vi.waitFor(() =>
			expect(listen).toHaveBeenCalledWith(
				"agent-shell-change",
				expect.any(Function),
			),
		);
		dispatchAgentShellChange({
			source: "canonical",
			state: saved,
			saved: true,
		});
		await vi.waitFor(() => expect(element.textContent).toBe("Saved:ok"));
		element.querySelector("button")!.click();
		await vi.waitFor(() => expect(element.textContent).toBe("Optimistic:ok"));
		dispatchAgentShellChange({
			source: "canonical",
			state: saved,
			error: "Save failed",
		});
		await vi.waitFor(() =>
			expect(element.textContent).toBe("Saved:Save failed"),
		);
		dispatchAgentShellChange({
			source: "canonical",
			state: saved,
			saved: true,
		});
		await vi.waitFor(() => expect(element.textContent).toBe("Saved:ok"));
	} finally {
		root.unmount();
		dom.window.close();
	}
});
