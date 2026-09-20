import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { project } from "../../src/shared/lib/native.tsx";

test("clicking a file pane gives its contents scroll ownership", () => {
	const source = readFileSync(
		new URL(
			"../../src/modules/workspace/components/WorkspaceCanvas/index.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
		source.slice(
			source.indexOf("const handleWheelCapture ="),
			source.indexOf(
				"\n\tcreateEffect(",
				source.indexOf("const handleWheelCapture ="),
			),
		),
	);
	class Element {
		dataset = { agentGridPaneId: "file" };
		scrollTop = 0;
		clientHeight = 300;
		scrollHeight = 1000;
		parentElement: Element | null = null;
		closest() {
			return pane;
		}
		querySelectorAll() {
			return [content];
		}
	}
	const pane = new Element();
	const content = new Element();
	content.parentElement = pane;
	const canvas = { scrollTop: 0, scrollLeft: 0 };
	let selected = false;
	const dependencies = {
		props: { layoutMode: "grid", selectedPaneId: "chat" },
		containerRef: { current: canvas },
		auxiliaryPanels: () => [{ id: "file", selected }],
		Element,
		HTMLElement: Element,
		getComputedStyle: () => ({ overflowY: "auto" }),
		project,
	};
	const wheel = new Function(
		...Object.keys(dependencies),
		`${code}; return handleWheelCapture;`,
	)(...Object.values(dependencies));
	let prevented = false;
	const event = {
		target: content,
		deltaX: 0,
		deltaY: 50,
		shiftKey: false,
		preventDefault: () => {
			prevented = true;
		},
		stopPropagation: () => {},
	};
	wheel(event);
	expect(prevented).toBe(true);
	expect(canvas.scrollTop).toBe(50);
	selected = true;
	prevented = false;
	wheel(event);
	expect(prevented).toBe(false);
	expect(canvas.scrollTop).toBe(50);
	content.scrollTop = 700;
	wheel(event);
	expect(prevented).toBe(true);
	expect(canvas.scrollTop).toBe(100);
});
