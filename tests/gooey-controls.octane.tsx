import { JSDOM } from "jsdom";
import { createRoot } from "octane";
import { expect, test, vi } from "vitest";
import { Button } from "../src/shared/ui/Button.tsx";
import { DropdownButton } from "../src/shared/ui/DropdownButton.tsx";
import { LiquidSegmentedRail } from "../src/shared/ui/gooey/LiquidSegmentedRail.tsx";

class TestResizeObserver {
	observe(): void {}
	disconnect(): void {}
}

function setupDom() {
	const dom = new JSDOM('<div id="root"></div>', {
		pretendToBeVisual: true,
		url: "http://localhost/",
	});
	Object.defineProperty(dom.window, "matchMedia", {
		configurable: true,
		value: () => ({
			matches: true,
			addEventListener: () => {},
			removeEventListener: () => {},
		}),
	});
	Object.defineProperties(globalThis, {
		window: { configurable: true, value: dom.window },
		document: { configurable: true, value: dom.window.document },
		Node: { configurable: true, value: dom.window.Node },
		Element: { configurable: true, value: dom.window.Element },
		HTMLElement: { configurable: true, value: dom.window.HTMLElement },
		SVGElement: { configurable: true, value: dom.window.SVGElement },
		MutationObserver: {
			configurable: true,
			value: dom.window.MutationObserver,
		},
		ResizeObserver: { configurable: true, value: TestResizeObserver },
		getComputedStyle: {
			configurable: true,
			value: dom.window.getComputedStyle.bind(dom.window),
		},
		requestAnimationFrame: {
			configurable: true,
			value: dom.window.requestAnimationFrame.bind(dom.window),
		},
		cancelAnimationFrame: {
			configurable: true,
			value: dom.window.cancelAnimationFrame.bind(dom.window),
		},
	});
	Object.assign(dom.window, { ResizeObserver: TestResizeObserver });
	const rootElement = dom.window.document.getElementById("root");
	if (!rootElement) throw new Error("Missing root element");
	return { root: createRoot(rootElement), rootElement };
}

function tick(ms = 30) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

test("a liquid button keeps its semantic control immediate and clickable", async () => {
	const { root, rootElement } = setupDom();
	const onClick = vi.fn();
	try {
		root.render(
			<Button type="button" variant="primary" onClick={onClick}>
				Run agent
			</Button>,
		);
		await tick();

		const button = rootElement.querySelector("button");
		expect(button?.textContent?.trim()).toBe("Run agent");
		expect(rootElement.querySelector("svg filter")).not.toBeNull();
		button?.click();
		expect(onClick).toHaveBeenCalledTimes(1);
	} finally {
		root.unmount();
	}
});

test("a shared dropdown contributes its portalled menu to one liquid group", async () => {
	const { root, rootElement } = setupDom();
	const onChange = vi.fn();
	try {
		root.render(
			<DropdownButton
				value="main"
				options={[
					{ id: "main", label: "main" },
					{ id: "develop", label: "develop" },
				]}
				onChange={onChange}
			/>,
		);
		await tick();
		rootElement.querySelector("button")?.click();
		await tick();

		expect(rootElement.querySelector("[data-gooey-svg]")).not.toBeNull();

		const option = Array.from(document.body.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "develop",
		);
		expect(option).toBeDefined();
		expect(
			rootElement.querySelectorAll("[data-gooey-svg] rect").length,
		).toBeGreaterThanOrEqual(2);
		option?.click();
		expect(onChange).toHaveBeenCalledWith("develop");
		await tick();
		expect(
			document.body.querySelector(".inferay-liquid-popover-panel--closing"),
		).not.toBeNull();
		await tick(230);
		expect(
			document.body.querySelector(".inferay-liquid-popover-panel"),
		).toBeNull();
	} finally {
		root.unmount();
	}
});

test("a tab rail moves the tracked child through one continuous liquid surface", async () => {
	const { root, rootElement } = setupDom();
	try {
		root.render(
			<div style={{ position: "relative", height: 67, width: 32 }}>
				<LiquidSegmentedRail
					activeIndex={1}
					itemCount={2}
					direction="vertical"
					itemSize={32}
					gap={3}
				/>
			</div>,
		);
		await tick();
		const carrier = rootElement.querySelector(
			".inferay-liquid-segmented-rail__carrier",
		);
		expect(carrier?.getAttribute("style")).toContain("translateY(35px)");
		expect(rootElement.querySelector("[data-gooey-svg]")).not.toBeNull();
	} finally {
		root.unmount();
	}
});
