import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compile } from "octane/compiler";
import { renderToStaticMarkup } from "octane/server";

const file = new URL(
	"../../src/shared/ui/MarkdownInline/index.tsx",
	import.meta.url,
);
const compiled = compile(readFileSync(file, "utf8"), fileURLToPath(file), {
	mode: "server",
});
const code = compiled.code.replace(
	/from (["'])octane(?:\/server)?\1/g,
	`from '${import.meta.resolve("octane/server")}'`,
);
const { MarkdownInline } = await import(
	`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);
const render = (tokens, appearance = {}, onMdFileClick) =>
	renderToStaticMarkup(MarkdownInline, { tokens, appearance, onMdFileClick })
		.html;

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
			"bold-italic": { className: "bold" },
			boldItalicEm: { className: "italic" },
		},
	);
	assert.match(html, /class="bold"/);
	assert.match(html, /class="italic"/);
	assert.match(html, /&lt;unsafe&gt;&amp;/);
	assert.match(html, /<code>a&lt;b<\/code>/);
});

test("preview and chat retain different autolink and image fallback behavior", () => {
	const url = [
		{ type: "url", text: "example", href: "https://example.com/?a=1&b=2" },
	];
	assert.doesNotMatch(render(url), /<a /);
	assert.match(
		render(url, { url: { className: "link" } }),
		/rel="noopener noreferrer"/,
	);
	assert.match(
		render([{ type: "image", text: "fallback" }], { image: { alt: "" } }),
		/alt=""/,
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
