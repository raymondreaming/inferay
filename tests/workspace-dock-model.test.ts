import { describe, expect, test } from "bun:test";
import {
	createDockTree,
	dockAxisSpan,
	dockPanelIds,
	insertDockPanel,
	insertDockPanelAtOuterEdge,
	moveDockPanel,
	moveDockPanelToOuterEdge,
	parseDockTree,
	reconcileDockTree,
	resizeDockSplit,
} from "../src/components/workspace/workspace-dock-model.ts";

describe("workspace dock model", () => {
	test("builds and reconciles layouts without losing panels", () => {
		const initial = createDockTree(["chat-a", "chat-b", "file"], 2);
		expect(dockPanelIds(initial)).toEqual(["chat-a", "chat-b", "file"]);
		const reconciled = reconcileDockTree(
			initial,
			["chat-b", "file", "chat-c"],
			2,
		);
		expect(dockPanelIds(reconciled)).toEqual(["chat-b", "file", "chat-c"]);
	});

	test("docks one panel below another while preserving the remaining layout", () => {
		const initial = createDockTree(["chat-a", "chat-b", "file"], 3)!;
		const moved = moveDockPanel(initial, "file", "chat-b", "bottom");
		expect(dockPanelIds(moved)).toEqual(["chat-a", "chat-b", "file"]);
		expect(moved).toMatchObject({
			type: "split",
			direction: "horizontal",
			ratio: 1 / 2,
			second: {
				type: "split",
				direction: "vertical",
				first: { id: "chat-b" },
				second: { id: "file" },
			},
		});
		expect(dockAxisSpan(moved, "horizontal")).toBe(2);
		expect(dockAxisSpan(moved, "vertical")).toBe(2);
	});

	test("migrates legacy equal splits using lane proportions", () => {
		const parsed = parseDockTree(
			JSON.stringify({
				type: "split",
				direction: "horizontal",
				first: {
					type: "split",
					direction: "horizontal",
					first: { type: "panel", id: "chat-a" },
					second: { type: "panel", id: "chat-b" },
				},
				second: {
					type: "split",
					direction: "vertical",
					first: { type: "panel", id: "chat-c" },
					second: { type: "panel", id: "file" },
				},
			}),
		);
		expect(parsed).toMatchObject({ ratio: 2 / 3 });
	});

	test("resizes a nested split without changing its panels", () => {
		const initial = createDockTree(["chat-a", "chat-b", "file"], 3)!;
		const resized = resizeDockSplit(initial, ["first"], 0.7);
		expect(dockPanelIds(resized)).toEqual(["chat-a", "chat-b", "file"]);
		expect(resized).toMatchObject({
			first: { type: "split", ratio: 0.7 },
		});
		expect(
			reconcileDockTree(resized, ["chat-a", "chat-b", "file"], 3),
		).toMatchObject({ first: { ratio: 0.7 } });
	});

	test("center drops swap panels", () => {
		const initial = createDockTree(["chat-a", "chat-b"], 2)!;
		expect(
			dockPanelIds(moveDockPanel(initial, "chat-a", "chat-b", "center")),
		).toEqual(["chat-b", "chat-a"]);
	});

	test("tears a panel out into a full workspace edge", () => {
		const initial = createDockTree(["chat-a", "chat-b", "chat-c"], 2)!;
		const moved = moveDockPanelToOuterEdge(initial, "chat-c", "top");
		expect(dockPanelIds(moved)).toEqual(["chat-c", "chat-a", "chat-b"]);
		expect(moved).toMatchObject({
			type: "split",
			direction: "vertical",
			first: { type: "panel", id: "chat-c" },
		});
		expect(dockAxisSpan(moved, "horizontal")).toBe(2);
		expect(dockAxisSpan(moved, "vertical")).toBe(2);
	});

	test("inserts a dragged file tab as a new pane", () => {
		const initial = createDockTree(["chat-a", "files"], 2)!;
		const split = insertDockPanel(initial, "file:client.tsx", "chat-a", "top");
		expect(dockPanelIds(split)).toEqual(["file:client.tsx", "chat-a", "files"]);
		expect(split).toMatchObject({
			first: {
				type: "split",
				direction: "vertical",
				first: { id: "file:client.tsx" },
				second: { id: "chat-a" },
			},
		});

		const outer = insertDockPanelAtOuterEdge(
			initial,
			"file:client.tsx",
			"right",
		);
		expect(dockPanelIds(outer)).toEqual(["chat-a", "files", "file:client.tsx"]);
	});

	test("ignores malformed persisted layouts", () => {
		expect(parseDockTree('{"type":"split"}')).toBeNull();
		expect(parseDockTree("not-json")).toBeNull();
	});
});
