import { describe, expect, test } from "bun:test";
import { architectureViolations } from "../check-architecture-boundaries.ts";

describe("architecture boundaries", () => {
	test("rejects a shared module that reaches into a feature", () => {
		const violations = architectureViolations({
			"src/shared/lib/example.ts":
				'import "../../modules/workspace/example.ts";',
		});
		expect(violations).toContain(
			"src/shared/lib/example.ts: shared code must not import app, modules, or adapters",
		);
	});

	test("rejects direct network access outside the native client", () => {
		const violations = architectureViolations({
			"src/modules/example.ts": 'fetch("/api/example");',
		});
		expect(violations).toContain(
			"src/modules/example.ts: only src/shared/lib/native.tsx may call fetch()",
		);
	});

	test("requires new endpoint transport to live in a feature service", () => {
		const violations = architectureViolations({
			"src/modules/example/hooks/useExample.ts":
				'import { fetchJson } from "@shared/lib/native.tsx";\nvoid fetchJson("/api/example");',
		});
		expect(violations).toContain(
			"src/modules/example/hooks/useExample.ts: endpoint transport belongs in its feature service",
		);
	});

	test("caps new component files at 500 lines", () => {
		const violations = architectureViolations({
			"src/modules/example/components/Example/index.tsx": "\n".repeat(501),
		});
		expect(violations).toContain(
			"src/modules/example/components/Example/index.tsx: exceeds its 500-line responsibility cap",
		);
	});

	test("shared aliases cannot bypass inward dependencies", () => {
		expect(
			architectureViolations({
				"src/shared/model/example.ts":
					'import { value } from "@workspace/model/example.ts";',
			}),
		).toContain(
			"src/shared/model/example.ts: shared code must not import app, modules, or adapters",
		);
	});

	test.each([
		'import { sendJson as send } from "../lib/native.tsx";',
		'import * as native from "../lib/native.tsx";',
		'export { postJson } from "../lib/native.tsx";',
		'const native = await import("../lib/native.tsx");',
	])(
		"relative or re-exported native transport stays in services: %s",
		(source) => {
			expect(
				architectureViolations({ "src/shared/hooks/example.ts": source }),
			).toContain(
				"src/shared/hooks/example.ts: endpoint transport belongs in its feature service",
			);
		},
	);

	test.each([
		'import { createMemo } from "solid-js";',
		'import type { View } from "@workspace/components/View.tsx";',
		'import { save } from "../services/workspaceApi.ts";',
		'import { project } from "@shared/lib/native.tsx";',
	])("models stay independent of framework and adapters: %s", (source) => {
		expect(
			architectureViolations({
				"src/modules/workspace/model/example.ts": source,
			}),
		).toContain(
			"src/modules/workspace/model/example.ts: models must not import UI, hooks, services, or runtime adapters",
		);
	});

	test("feature modules cannot import the composition root", () => {
		expect(
			architectureViolations({
				"src/modules/workspace/hooks/example.ts":
					'import "@app/components/RootComponent/index.tsx";',
			}),
		).toContain(
			"src/modules/workspace/hooks/example.ts: features must not import the composition root",
		);
	});

	test("rejects cycles in relative production imports", () => {
		const violations = architectureViolations({
			"src/modules/example/a.ts": 'import "./b.ts";',
			"src/modules/example/b.ts": 'import "./a.ts";',
		});
		expect(violations[0]).toContain("circular dependency");
	});

	test("rejects cycles that cross an owning-layer alias", () => {
		const violations = architectureViolations({
			"src/modules/repository/a.ts": 'import "@repository/b.ts";',
			"src/modules/repository/b.ts": 'import "./a.ts";',
		});
		expect(violations[0]).toContain("circular dependency");
	});
});
