import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { project } from "../../src/shared/lib/native.tsx";

test("repeated graph navigation retains focus before virtual rows are removed", () => {
	const source = readFileSync(
		new URL(
			"../../src/modules/repository/components/graph/components/CommitGraph/useCommitGraphState.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
		source.slice(
			source.indexOf("const navigateRows ="),
			source.indexOf("\n\tconst startColumnResize ="),
		),
	);
	let focused = "row";
	let selected = "a";
	const selections: string[] = [];
	const commits = ["wip", "a", "b", "c", "d"].map((id) => ({
		id,
		navigation: {},
	}));
	const dependencies = {
		project,
		repositoryKeyboardInput: (event: KeyboardEvent) => ({
			key: event.key,
			meta: event.metaKey,
			ctrl: event.ctrlKey,
			alt: event.altKey,
			shift: event.shiftKey,
			repeat: event.repeat,
			blocked: event.defaultPrevented,
		}),
		rustProject: project,
		graphModel: () => ({ selectableItems: commits.map(({ id }) => id) }),
		_props: () => ({
			commits,
			selectedHash: selected,
			onSelect: (id: string) => {
				// Removing a focused virtual row sends browser focus to body.
				if (focused === "row") focused = "body";
				selected = id;
				selections.push(id);
			},
		}),
		keyboardNavigationRef: { current: false },
		setHoveredRow: () => {},
		revealKeyboardRow: () => {},
		scrollerRef: {
			current: {
				focus: () => {
					focused = "graph";
				},
			},
		},
	};
	const navigate = new Function(
		...Object.keys(dependencies),
		`${code}; return navigateRows;`,
	)(...Object.values(dependencies));
	for (let index = 0; index < 3; index++) {
		if (focused === "body") break;
		navigate({ key: "ArrowDown", repeat: index > 0, preventDefault() {} });
	}
	expect(selections).toEqual(["b", "c", "d"]);
	expect(focused).toBe("graph");
	for (let index = 0; index < 5; index++)
		navigate({ key: "ArrowUp", preventDefault() {} });
	expect(selected).toBe("wip");
	navigate({ key: "ArrowDown", preventDefault() {} });
	expect(selected).toBe("a");
});

test("Space from the commit sidebar scrolls the current diff without changing focus", () => {
	const source = readFileSync(
		new URL(
			"../../src/modules/repository/hooks/useRepositoryWorkbench.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const start = source.indexOf("const handleDiffKeyboardNavigation =");
	const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(
		source.slice(start, source.indexOf("\n\tcreateEffect(", start)),
	);
	const pages: number[] = [];
	const target = { closest: () => null };
	const dependencies = {
		rustProject: project,
		repositoryKeyboardInput: (event: KeyboardEvent) => ({
			key: event.key,
			shift: event.shiftKey,
		}),
		HTMLTextAreaElement: class {},
		document: { body: {} },
		panelSession: () => ({
			mainViewMode: "diff",
			sidebarVisible: true,
			historicalDiff: true,
			selectedFile: { path: "a.rs" },
		}),
		sidebarElement: { contains: (element: unknown) => element === target },
		diffRailElement: {
			querySelector: () => ({
				clientHeight: 600,
				scrollBy: ({ top }: { top: number }) => pages.push(top),
			}),
		},
	};
	const handle = new Function(
		...Object.keys(dependencies),
		`${code}; return handleDiffKeyboardNavigation;`,
	)(...Object.values(dependencies));
	let prevented = 0;
	for (const shiftKey of [false, false, true])
		handle({
			key: " ",
			target,
			shiftKey,
			preventDefault() {
				prevented++;
			},
		});
	expect(pages).toEqual([540, 540, -540]);
	expect(prevented).toBe(3);
});

test("returning from a diff restores graph focus after the graph mounts", () => {
	const source = readFileSync(
		new URL(
			"../../src/modules/repository/hooks/useRepositoryWorkbench.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const start = source.indexOf("const closeDiffViewer =");
	const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(
		source.slice(
			start,
			source.indexOf("\n\tconst returnsToGraphOnClose", start),
		),
	);
	let mode = "diff";
	let mounted = false;
	let active = true;
	let focused = "sidebar";
	let frame = () => {};
	const dependencies = {
		setZenMode: () => {},
		updatePanelSession: () => {
			mode = "graph";
		},
		panelSession: () => ({ graphVisible: true, mainViewMode: mode }),
		_options: () => ({ active }),
		requestAnimationFrame: (callback: () => void) => {
			frame = callback;
		},
		diffRailElement: {
			querySelector: () =>
				mounted
					? {
							focus: () => {
								focused = "graph";
							},
						}
					: null,
		},
	};
	const close = new Function(
		...Object.keys(dependencies),
		`${code}; return closeDiffViewer;`,
	)(...Object.values(dependencies));
	close();
	expect(focused).toBe("sidebar");
	mounted = true;
	frame();
	expect(focused).toBe("graph");
	close();
	active = false;
	focused = "other repository";
	frame();
	expect(focused).toBe("other repository");
});
