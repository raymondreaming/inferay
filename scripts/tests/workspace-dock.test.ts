import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as signals from "@solidjs/signals";

test("canceling a dock drag releases pointer listeners without selecting a pane", () => {
	const source = readFileSync(
		new URL(
			"../../src/modules/workspace/components/WorkspaceCanvas/useWorkspaceDock.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
		source
			.slice(source.indexOf("export function useWorkspaceDock"))
			.replace("export ", ""),
	);
	const window = new EventTarget();
	const element = Object.assign(new EventTarget(), {
		setPointerCapture() {},
		releasePointerCapture() {},
	});
	let releases = 0;
	const selected: string[] = [];
	const dependencies = {
		...signals,
		window,
		createPointerResize: () => () => {},
		lockPointerSelection: () => () => {
			releases++;
		},
		observeResponsiveGridColumns: () => {},
		createDockLayout: () => ({
			tree: () => null,
			layout: () => ({ tree: null }),
			setLayout() {},
			update: () => Promise.resolve(true),
			error: () => null,
		}),
	};
	const useDock = new Function(
		...Object.keys(dependencies),
		`${code}; return useWorkspaceDock;`,
	)(...Object.values(dependencies));
	const fixture = signals.createRoot((dispose) => {
		const [active, setActive] = signals.createSignal(true);
		const dock = useDock(
			{
				get active() {
					return active();
				},
				panes: [{ id: "one" }],
				columns: 1,
				rows: 1,
				onSelectPane: (id: string) => selected.push(id),
			},
			{ current: null },
		);
		return { dock, dispose, setActive };
	});
	const start = () =>
		fixture.dock.beginDrag(
			{
				button: 0,
				pointerId: 1,
				clientX: 0,
				clientY: 0,
				currentTarget: element,
				preventDefault() {},
				stopPropagation() {},
			},
			"one",
		);
	const end = (type: string) =>
		window.dispatchEvent(Object.assign(new Event(type), { pointerId: 1 }));
	try {
		signals.flush();
		start();
		end("pointercancel");
		end("pointerup");
		expect(selected).toEqual([]);
		expect(releases).toBe(1);
		start();
		end("pointerup");
		expect(selected).toEqual(["one"]);
		expect(releases).toBe(2);
		start();
		fixture.setActive(false);
		signals.flush();
		end("pointerup");
		expect(selected).toEqual(["one"]);
		expect(releases).toBe(3);
	} finally {
		fixture.dispose();
	}
});
