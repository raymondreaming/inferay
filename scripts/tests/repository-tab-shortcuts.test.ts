import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { project } from "../../src/shared/lib/native.tsx";

test("Command arrows wrap repository tabs from the graph and clean chat-only views", () => {
	const source = readFileSync(
		new URL(
			"../../src/modules/workspace/components/RepositoryWorkspaceBar/RepositoryWorkspaceTabs.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
		source.slice(
			source.indexOf("let tabList:"),
			source.indexOf("\n\tconst tabsProps ="),
		),
	);
	const tabs = [{ cwd: "/one" }, { cwd: "/two" }, { cwd: "/three" }];
	let activePath = "/one";
	let handler!: (event: object) => void;
	let capture = false;
	let cleanup = () => {};
	class Target {
		isContentEditable = false;
		constructor(private editable = false) {}
		closest(selector: string) {
			return this.editable && selector.includes("input") ? this : null;
		}
	}
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
		HTMLElement: Target,
		props: {
			get activePath() {
				return activePath;
			},
			tabDrag: { ordered: () => tabs },
			onActivate: (tab: { cwd: string }) => {
				activePath = tab.cwd;
			},
		},
		onSettled: (callback: () => () => void) => {
			cleanup = callback();
		},
		window: {
			addEventListener: (
				_type: string,
				callback: typeof handler,
				capturing: boolean,
			) => {
				handler = callback;
				capture = capturing;
			},
			removeEventListener: (
				_type: string,
				callback: typeof handler,
				capturing: boolean,
			) => {
				expect(callback).toBe(handler);
				expect(capturing).toBe(true);
			},
		},
	};
	new Function(...Object.keys(dependencies), code)(
		...Object.values(dependencies),
	);
	const press = (key: string, editable = false, metaKey = true) => {
		let prevented = false;
		let stopped = false;
		handler({
			key,
			metaKey,
			target: new Target(editable),
			preventDefault() {
				prevented = true;
			},
			stopPropagation() {
				stopped = true;
			},
		});
		return { prevented, stopped };
	};
	try {
		expect(capture).toBe(true);
		expect(press("ArrowRight")).toEqual({ prevented: true, stopped: true });
		expect(activePath).toBe("/two");
		press("ArrowRight");
		press("ArrowRight");
		expect(activePath).toBe("/one");
		press("ArrowLeft");
		expect(activePath).toBe("/three");
		// A clean repository with the graph hidden focuses its chat composer.
		expect(press("ArrowRight", true)).toEqual({
			prevented: true,
			stopped: true,
		});
		expect(activePath).toBe("/one");
		press("ArrowLeft", true);
		expect(activePath).toBe("/three");
		expect(press("ArrowRight", false, false)).toEqual({
			prevented: false,
			stopped: false,
		});
		expect(activePath).toBe("/three");
		activePath = "/missing";
		press("ArrowRight");
		expect(activePath).toBe("/one");
		activePath = "/missing";
		press("ArrowLeft");
		expect(activePath).toBe("/three");
		tabs.splice(1);
		activePath = "/one";
		expect(press("ArrowRight")).toEqual({ prevented: true, stopped: true });
		expect(activePath).toBe("/one");
		tabs.splice(0);
		expect(press("ArrowLeft")).toEqual({ prevented: true, stopped: true });
	} finally {
		cleanup();
	}
});
