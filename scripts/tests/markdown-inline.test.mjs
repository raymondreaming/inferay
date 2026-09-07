import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { transform as compile } from "@solidjs/compiler";
import { transformWithOxc } from "vite";
import { renderToString } from "@solidjs/web";

const file = new URL(
	"../../src/shared/ui/MarkdownInline/index.tsx",
	import.meta.url,
);
const compiled = compile(readFileSync(file, "utf8"), {
  filename: fileURLToPath(file), generate: "ssr", hydratable: false, omitQuotes: false,
});
const stripped = await transformWithOxc(compiled.code, fileURLToPath(file), { lang: "ts" });
const code = stripped.code.replace(
  /from (["'])(@solidjs\/web|solid-js)\1/g,
  (_, quote, name) => `from '${import.meta.resolve(name)}'`,
);
const { MarkdownInline } = await import(
	`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);
const render = (tokens, appearance = {}, onMdFileClick) =>
	renderToString(() => MarkdownInline({ tokens, appearance, onMdFileClick }), { noScripts: true });

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

test("preview and chat retain different autolink and image fallback behavior", () => {
	const url = [
		{ type: "url", text: "example", href: "https://example.com/?a=1&b=2" },
	];
	assert.doesNotMatch(render(url), /<a /);
	assert.match(
		render(url, { url: { class: "link" } }),
		/rel="noopener noreferrer"/,
	);
	assert.match(
		render([{ type: "image", text: "fallback" }], { image: { alt: "" } }),
		/alt(?:="")?(?=\s|\/?>)/,
	);
	assert.match(render([{ type: "image", text: "fallback" }]), /alt="fallback"/);
});

test("markdown paths become controls only when the view handles them", () => {
	const tokens = [{ type: "markdown_path", text: "README.md" }];
	assert.match(
		render(tokens, {}, () => {}),
		/<button/,
	);
	assert.doesNotMatch(render(tokens), /<button/);
});
