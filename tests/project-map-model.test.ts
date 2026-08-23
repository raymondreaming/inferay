import { describe, expect, test } from "bun:test";
import {
	atlasFileLabel,
	buildDistrictFileNodes,
	buildProjectAtlas,
	districtIdForPath,
	type ProjectMapData,
} from "../src/components/graph/project-map-model.ts";

const map: ProjectMapData = {
	name: "atlas",
	cwd: "/atlas",
	totalFiles: 3,
	totalLines: 60,
	totalBytes: 600,
	directoryCount: 2,
	symbolCount: 2,
	languageCounts: { TypeScript: 3 },
	truncated: false,
	files: [
		{
			name: "main.ts",
			path: "src/app/main.ts",
			directory: "src/app",
			extension: "ts",
			language: "TypeScript",
			lines: 30,
			bytes: 300,
			symbols: [{ kind: "function", name: "main", line: 2 }],
		},
		{
			name: "view.ts",
			path: "src/ui/view.ts",
			directory: "src/ui",
			extension: "ts",
			language: "TypeScript",
			lines: 20,
			bytes: 200,
			symbols: [{ kind: "component", name: "View", line: 1 }],
		},
		{
			name: "view.test.ts",
			path: "tests/view.test.ts",
			directory: "tests",
			extension: "ts",
			language: "TypeScript",
			lines: 10,
			bytes: 100,
			symbols: [],
		},
	],
	edges: [
		{ source: "src/app/main.ts", target: "src/ui/view.ts" },
		{ source: "tests/view.test.ts", target: "src/ui/view.ts" },
	],
};

describe("project atlas model", () => {
	test("builds compact file labels while disambiguating index modules", () => {
		expect(
			atlasFileLabel({ directory: "src/AuthFormClient", name: "index.tsx" }),
		).toBe("AuthFormClient/index");
		expect(atlasFileLabel({ directory: "tests", name: "view.test.ts" })).toBe(
			"view.test",
		);
	});

	test("groups source files into stable, meaningful districts", () => {
		expect(districtIdForPath("src/components/chat/View.tsx")).toBe(
			"src/components",
		);
		expect(districtIdForPath("tests/view.test.ts")).toBe("tests");
		expect(districtIdForPath("Cargo.toml")).toBe("root");
	});

	test("aggregates only verified file edges into district topology", () => {
		const atlas = buildProjectAtlas(map, null);
		const app = atlas.districts.find((district) => district.id === "src/app");
		const tests = atlas.districts.find((district) => district.id === "tests");

		expect(app?.connections).toEqual([{ target: "src/ui", count: 1 }]);
		expect(tests?.connections).toEqual([{ target: "src/ui", count: 1 }]);
		expect(atlas.primaryPath.length).toBeGreaterThan(1);
	});

	test("preserves real file relationships in a district scene", () => {
		const sameDistrict = {
			...map,
			files: map.files.slice(0, 2).map((file) => ({
				...file,
				path: file.path.replace("src/ui", "src/app"),
				directory: "src/app",
			})),
			edges: [{ source: "src/app/main.ts", target: "src/app/view.ts" }],
		};
		const atlas = buildProjectAtlas(sameDistrict, null);
		const nodes = buildDistrictFileNodes(
			atlas.districts[0]!,
			sameDistrict.edges,
			null,
		);

		expect(nodes[0]?.connections).toEqual([
			{ target: "src/app/view.ts", count: 1 },
		]);
	});
});
