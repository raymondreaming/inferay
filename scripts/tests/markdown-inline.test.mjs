import assert from "node:assert/strict";
import { test } from "node:test";
import solid from "@solidjs/vite-plugin";
import { renderToString } from "@solidjs/web";
import { createServer } from "vite";

// Keep imports in a normal module graph, including local TypeScript helpers.
const server = await createServer({
	configFile: false,
	optimizeDeps: { noDiscovery: true, include: [] },
	resolve: {
		alias: { "@shared": new URL("../../src/shared", import.meta.url).pathname },
	},
	plugins: [solid({ ssr: true, solid: { omitQuotes: false } })],
	server: { middlewareMode: true },
	appType: "custom",
});
let MarkdownInline;
try {
	({ MarkdownInline } = await server.ssrLoadModule(
		"/src/shared/ui/MarkdownInline/index.tsx",
	));
} finally {
	await server.close();
}
const render = (tokens, appearance = {}, onMdFileClick) =>
	renderToString(() => MarkdownInline({ tokens, appearance, onMdFileClick }), {
		noScripts: true,
	});

test("nested formatting preserves the view's styles and escapes text", () => {
	const html = render(
		[
			{
				type: "bold-italic",
				text: "",
				children: [
					{ type: "text", text: "<unsafe>&" },
					{ type: "code", text: "a<b" },
				],
			},
		],
		{
			"bold-italic": { class: "bold" },
			boldItalicEm: { class: "italic" },
		},
	);
	assert.match(html, /class="bold"/);
	assert.match(html, /class="italic"/);
	assert.match(html, /&lt;unsafe(?:&gt;|>)&amp;/);
	assert.match(html, /<code[^>]*>a&lt;b<\/code>/);
});

test("local image sources use the host endpoint and missing sources show a fallback", () => {
	for (const href of [
		"file:///tmp/my%20image.png",
		"sandbox:/tmp/my image.png",
		"/tmp/my image.png",
	]) {
		assert.match(
			render([{ type: "image", text: "image", href }]),
			/src="\/api\/file\?path=%2Ftmp%2Fmy%20image.png"/,
		);
	}
	assert.match(render([{ type: "image", text: "image" }]), /Image unavailable/);
	assert.doesNotMatch(
		render([
			{ type: "image", text: "image", href: "file://remote/tmp/image.png" },
		]),
		/<img/,
	);
});
