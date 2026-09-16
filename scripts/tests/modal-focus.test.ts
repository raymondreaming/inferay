import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("closing a modal restores its live graph target instead of a removed row", () => {
	const source = readFileSync(
		new URL("../../src/shared/ui/Modal/index.tsx", import.meta.url),
		"utf8",
	);
	const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
		source.slice(
			source.indexOf("onSettled(() =>"),
			source.indexOf("\n\tconst outside"),
		),
	);
	let focused = "dialog";
	let frame = () => {};
	let cleanup = () => {};
	class Target {
		isConnected = true;
		visible = true;
		constructor(readonly name: string) {}
		getClientRects() {
			return this.visible ? [{}] : [];
		}
		focus() {
			focused = this.name;
		}
	}
	const previous = new Target("old row");
	const graph = new Target("graph");
	const dependencies = {
		HTMLElement: Target,
		document: { activeElement: previous },
		props: { returnFocus: () => graph },
		dialog: { showModal() {}, close() {} },
		onSettled: (callback: () => () => void) => {
			cleanup = callback();
		},
		requestAnimationFrame: (callback: () => void) => {
			frame = callback;
		},
	};
	new Function(...Object.keys(dependencies), code)(
		...Object.values(dependencies),
	);
	previous.isConnected = false;
	cleanup();
	frame();
	expect(focused).toBe("graph");
	// A retained repository tab must not steal focus after the user switches tabs.
	focused = "other repository";
	graph.visible = false;
	cleanup();
	frame();
	expect(focused).toBe("other repository");
});
