import { JSDOM } from "jsdom";
import { createRoot } from "octane";
import { describe, expect, test, vi } from "vitest";
import type { PreparedMarkdown } from "../src/shared/lib/markdown.ts";
import { stylexTestTypes } from "./stylex-test-mock.ts";

const mock = Object.assign(vi.fn, {
	module: (path: string, factory: () => unknown) => vi.doMock(path, factory),
});

mock.module("@octanejs/stylex", () => ({
	create: <T extends Record<string, unknown>>(styles: T) => styles,
	createTheme: (_vars: unknown, values: unknown) => values,
	defineConsts: <T extends Record<string, string>>(values: T) => values,
	defineVars: <T extends Record<string, string>>(values: T) => values,
	types: stylexTestTypes,
	keyframes: () => "test-keyframes",
	props: (
		...styles: Array<Record<string, unknown> | false | null | undefined>
	) => ({
		className: styles
			.filter(Boolean)
			.map((_, index) => `sx-${index}`)
			.join(" "),
	}),
}));

async function renderHtml(
	ui: unknown,
	ready?: (container: HTMLElement) => void,
) {
	const dom = new JSDOM('<div id="root"></div>', {
		pretendToBeVisual: true,
		url: "http://localhost/",
	});
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: dom.window,
	});
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: dom.window.document,
	});
	Object.defineProperty(globalThis, "HTMLElement", {
		configurable: true,
		value: dom.window.HTMLElement,
	});
	Object.defineProperty(globalThis, "Element", {
		configurable: true,
		value: dom.window.Element,
	});
	Object.defineProperty(globalThis, "Node", {
		configurable: true,
		value: dom.window.Node,
	});
	Object.defineProperty(globalThis, "SVGElement", {
		configurable: true,
		value: dom.window.SVGElement,
	});
	const container = dom.window.document.getElementById("root");
	if (!container) throw new Error("Missing root element");
	const root = createRoot(container);
	root.render(ui);
	await new Promise((resolve) => setTimeout(resolve, 20));
	try {
		if (ready) await vi.waitFor(() => ready(container));
		return container.innerHTML;
	} finally {
		root.unmount();
	}
}

describe("chat markdown rendering", () => {
	test("keeps long streaming and completed markdown structurally stable", async () => {
		const { Markdown } = await import(
			"../src/modules/conversation/components/ChatRichContent.tsx"
		);
		const tail = Array.from({ length: 90 }, () => "tail **still raw**").join(
			" ",
		);
		const text = `# Done\n\nParagraph with **bold** text.\n\n${tail}`;
		const prepared: PreparedMarkdown = {
			version: 1,
			blocks: [
				{
					type: "heading",
					level: 1,
					content: "Done",
					tokens: [{ type: "text", text: "Done" }],
				},
				{
					type: "paragraph",
					content: "",
					tokens: [
						{ type: "text", text: "Paragraph with " },
						{ type: "bold", text: "bold" },
						{ type: "text", text: " text." },
					],
				},
				{
					type: "paragraph",
					content: tail,
					tokens: Array.from({ length: 90 }, () => [
						{ type: "text" as const, text: "tail " },
						{ type: "bold" as const, text: "still raw" },
						{ type: "text" as const, text: " " },
					]).flat(),
				},
			],
		};
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => Response.json(prepared));
		try {
			const ready = (container: HTMLElement) =>
				expect(container.querySelectorAll("strong")).toHaveLength(91);
			const streamingHtml = await renderHtml(
				<Markdown streaming text={text} />,
				ready,
			);
			const completedHtml = await renderHtml(<Markdown text={text} />, ready);
			expect(streamingHtml).toContain("Done");
			expect(streamingHtml).toBe(completedHtml);
		} finally {
			fetchMock.mockRestore();
		}
	});

	test("renders copy controls for fenced code blocks", async () => {
		const { Markdown } = await import(
			"../src/modules/conversation/components/ChatRichContent.tsx"
		);
		const prepared: PreparedMarkdown = {
			version: 1,
			blocks: [{ type: "code", content: "const value = 1;", lang: "ts" }],
		};
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => Response.json(prepared));
		try {
			const html = await renderHtml(
				<Markdown text={"```ts\nconst value = 1;\n```"} />,
				(container) =>
					expect(container.querySelector('[title="Copy"]')).not.toBeNull(),
			);
			expect(html).toContain("<pre");
			expect(html).toContain("const value = 1;");
			expect(html).toContain('title="Copy"');
		} finally {
			fetchMock.mockRestore();
		}
	});

	test("renders copy controls for raw tool question output", async () => {
		const { AskUserQuestionCard } = await import(
			"../src/modules/conversation/components/ChatRichContent.tsx"
		);
		const html = await renderHtml(
			<AskUserQuestionCard content="raw tool output" />,
		);

		expect(html).toContain("<pre");
		expect(html).toContain("raw tool output");
		expect(html).toContain('title="Copy"');
	});
});
