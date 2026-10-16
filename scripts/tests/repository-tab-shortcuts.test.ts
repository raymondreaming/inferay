import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("Command arrows switch project tabs and leave editing and dialogs alone", () => {
	const source = readFileSync(
		new URL(
			"../../src/modules/workspace/components/RepositoryWorkspaceBar/index.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const start = source.indexOf("const switchProject =");
	const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
		source.slice(start, source.indexOf("\n\t\twindow.addEventListener", start)),
	);
	let active = "one";
	let dialog = false;
	const tabs = [
		{ id: "one", archived: false },
		{ id: "old", archived: true },
		{ id: "two", archived: false },
		{ id: "three", archived: false },
	];
	class Target {
		constructor(private editing = false) {}
		closest() {
			return this.editing ? this : null;
		}
	}
	const press = new Function(
		"projects",
		"selectProject",
		"Element",
		"document",
		`${code}; return switchProject;`,
	)(
		{ list: () => tabs, selectedId: () => active },
		(id: string) => {
			active = id;
		},
		Target,
		{ querySelector: () => (dialog ? {} : null) },
	);
	const key = (key: string, editing = false, metaKey = true) => {
		let prevented = false;
		press({
			key,
			metaKey,
			target: new Target(editing),
			preventDefault() {
				prevented = true;
			},
			stopPropagation() {},
		});
		return prevented;
	};
	expect(key("ArrowRight")).toBe(true);
	expect(active).toBe("two");
	key("ArrowRight");
	key("ArrowRight");
	expect(active).toBe("one");
	key("ArrowLeft");
	expect(active).toBe("three");
	expect(key("ArrowRight", true)).toBe(false);
	expect(key("ArrowRight", false, false)).toBe(false);
	dialog = true;
	expect(key("ArrowRight")).toBe(false);
	expect(active).toBe("three");
});
