import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as signals from "@solidjs/signals";
import { project } from "../../src/shared/lib/native.tsx";

test("graph column changes propagate to mounted repositories and survive reload", () => {
	const source = readFileSync(
		new URL(
			"../../src/modules/repository/components/graph/components/CommitGraph/useCommitGraphState.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
		source
			.slice(
				source.indexOf("const GRAPH_PREFERENCES_KEY"),
				source.indexOf("export function scrollPreferencesKey"),
			)
			.replaceAll("export ", ""),
	);
	const stored = new Map<string, unknown>();
	const dependencies = {
		...signals,
		rustProject: project,
		readStoredJson: (key: string, fallback: unknown) =>
			stored.get(key) ?? fallback,
		writeStoredJson: (key: string, value: unknown) => stored.set(key, value),
	};
	const load = () =>
		new Function(
			...Object.keys(dependencies),
			`${code}; return useGraphPreferences;`,
		)(...Object.values(dependencies));
	const usePreferences = load();
	const [first, updateFirst] = usePreferences("/first");
	const [second, updateSecond] = usePreferences("/second");
	const order = [...first().order].reverse();
	updateFirst({ ...first(), order });
	signals.flush();
	expect(second().order).toEqual(order);
	updateSecond({ ...second(), widths: { ...second().widths, date: 240 } });
	signals.flush();
	expect(first().widths.date).toBe(240);
	expect(first().order).toEqual(order);
	const [reloaded] = load()("/third");
	expect(reloaded().order).toEqual(order);
	expect(reloaded().widths.date).toBe(240);
});
