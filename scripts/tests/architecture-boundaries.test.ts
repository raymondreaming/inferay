import { describe, expect, test } from "bun:test";
import { architectureViolations } from "../check-architecture-boundaries.ts";

describe("architecture boundaries", () => {
	test("the production source graph obeys the declared layers", () => {
		expect(architectureViolations()).toEqual([]);
	});

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
