import { describe, expect, test } from "bun:test";
import {
	constrainDockTreeColumns,
	createDockTree,
	dockAxisSpan,
	dockPanelIds,
	getGridCanvasWidthPercent,
	getResponsiveGridColumns,
	insertDockPanel,
	insertDockPanelAtOuterEdge,
	moveDockPanel,
	moveDockPanelToOuterEdge,
	parseDockTree,
	reconcileDockTree,
	resizeDockSplit,
} from "../src/modules/workbench/model/workbench-layout.ts";

describe("workspace dock model", () => {
	test("caps the preferred grid by the live canvas width", () => {
		expect(getResponsiveGridColumns(249, 4)).toBe(1);
		expect(getResponsiveGridColumns(400, 4)).toBe(1);
		expect(getResponsiveGridColumns(499, 4)).toBe(1);
		expect(getResponsiveGridColumns(500, 4)).toBe(2);
		expect(getResponsiveGridColumns(750, 4)).toBe(3);
		expect(getResponsiveGridColumns(1200, 3)).toBe(3);
	});

	test("keeps sparse grids aligned to their available column tracks", () => {
		expect(getGridCanvasWidthPercent(1, 3)).toBeCloseTo(100 / 3);
		expect(getGridCanvasWidthPercent(2, 3)).toBeCloseTo(200 / 3);
		expect(getGridCanvasWidthPercent(3, 3)).toBe(100);
		expect(getGridCanvasWidthPercent(1, 1)).toBe(100);
	});

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

	test("fills the final row before creating a vertically scrolling row", () => {
		const initial = createDockTree(["chat-a", "chat-b", "chat-c"], 3);
		const fourth = reconcileDockTree(
			initial,
			["chat-a", "chat-b", "chat-c", "chat-d"],
			3,
		)!;
		expect(dockAxisSpan(fourth, "horizontal")).toBe(3);
		expect(dockAxisSpan(fourth, "vertical")).toBe(2);

		const fifth = reconcileDockTree(
			fourth,
			["chat-a", "chat-b", "chat-c", "chat-d", "file"],
			3,
		)!;
		expect(dockAxisSpan(fifth, "horizontal")).toBe(3);
		expect(dockAxisSpan(fifth, "vertical")).toBe(2);
		expect(fifth).toMatchObject({
			type: "split",
			direction: "vertical",
			second: { type: "split", direction: "horizontal" },
		});
	});

	test("migrates saved layouts that exceed the selected column ceiling", () => {
		const legacySlices = createDockTree(
			["chat-a", "chat-b", "chat-c", "chat-d", "file"],
			5,
		)!;
		const migrated = constrainDockTreeColumns(legacySlices, 3);
		expect(dockPanelIds(migrated)).toEqual([
			"chat-a",
			"chat-b",
			"chat-c",
			"chat-d",
			"file",
		]);
		expect(dockAxisSpan(migrated, "horizontal")).toBe(3);
		expect(dockAxisSpan(migrated, "vertical")).toBe(2);
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
