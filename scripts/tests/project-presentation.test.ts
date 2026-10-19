import { expect, spyOn, test } from "bun:test";
import { importPluginLibrary } from "../../src/modules/workspace/services/projectsApi.ts";
import { project } from "../../src/shared/lib/native.tsx";

test("memory layout keeps IDs and finite positions across the WASM boundary", () => {
	const points = project("memoryGraphLayout", {
		nodes: [{ id: "a" }, { id: "😀" }],
		edges: [
			{ from: "a", to: "😀" },
			{ from: "missing", to: "a" },
		],
	});
	expect(points.map(([id]) => id)).toEqual(["a", "😀"]);
	expect(points[0][1].x).toBeCloseTo(90.04405706390918, 8);
	expect(points[1][1].y).toBeCloseTo(50.85755218726185, 8);
});

test("library import rejects excess directories before uploading files", () => {
	const fetch = spyOn(globalThis, "fetch");
	try {
		const file = new File([""], "file");
		const files = Array.from({ length: 499 }, (_, i) => ({
			path: `${i}/file`,
			file,
		}));
		expect(() => importPluginLibrary("project", "library", files)).toThrow(
			"1,000 entries",
		);
		expect(fetch).not.toHaveBeenCalled();
	} finally {
		fetch.mockRestore();
	}
});

test("dense memory layouts retain the previous browser coordinates", () => {
	const nodes = Array.from({ length: 100 }, (_, i) => ({ id: `node-${i}` }));
	const edges = nodes.flatMap((node, i) =>
		i
			? [
					{ from: node.id, to: nodes[i - 1].id },
					...(i > 7
						? [{ from: node.id, to: nodes[Math.floor(i / 3)].id }]
						: []),
				]
			: [],
	);
	const points = project("memoryGraphLayout", {
		nodes,
		edges,
	});
	// Captured from the former browser implementation. Native libm seeding
	// diverged by ~60 pixels here after the force iterations amplified roundoff.
	expect(points[0][1].x).toBeCloseTo(-363.1651811927213, 5);
	expect(points[0][1].y).toBeCloseTo(450.00504831505964, 5);
});

test("generated operations constrain input, output, and operation names", () => {
	// @ts-expect-error The result is a path, not a caller-selected boolean.
	const path: boolean = project("proposalPath", {
		path: "asset.txt",
		removal: false,
	});
	expect(String(path)).toBe("asset.txt");
	expect(
		// @ts-expect-error An explicit generic cannot bypass a typed operation's contract.
		project<number>("proposalPath", { path: "asset.txt", removal: false }),
	).toBe("asset.txt");
	// @ts-expect-error The path is required by the native request type.
	expect(() => project("proposalPath", {})).toThrow("missing field");
	// @ts-expect-error Unknown operation names are rejected before runtime.
	expect(() => project("unknownOperation", {})).toThrow();
});
