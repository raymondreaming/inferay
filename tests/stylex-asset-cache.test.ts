import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { octaneStylexPlugin } from "../vite.config.ts";

test("StyleX-only edits change the immutable CSS URL in the generated page", async () => {
	const fixture = await realpath(
		await mkdtemp(join(tmpdir(), "inferay-stylex-cache-")),
	);
	try {
		await mkdir(join(fixture, "src"));
		await writeFile(
			join(fixture, "index.html"),
			'<html><head></head><body><script type="module" src="/src/main.ts"></script></body></html>',
		);
		const compile = async (color: string) => {
			await writeFile(
				join(fixture, "src/main.ts"),
				`import * as stylex from "@octanejs/stylex";
import "virtual:stylex.css";
const styles = stylex.create({ button: { color: "${color}" } });
document.body.className = stylex.props(styles.button).className;`,
			);
			const result = await build({
				configFile: false,
				root: fixture,
				publicDir: false,
				logLevel: "silent",
				plugins: [octaneStylexPlugin()],
				resolve: {
					alias: {
						"@octanejs/stylex": fileURLToPath(
							new URL(
								"../node_modules/@octanejs/stylex/src/index.ts",
								import.meta.url,
							),
						),
					},
				},
				build: { write: false, minify: false },
			});
			const bundles = Array.isArray(result) ? result : [result];
			const assets = bundles.flatMap((bundle) =>
				"output" in bundle ? bundle.output : [],
			);
			const css = assets.find(
				(asset) => asset.type === "asset" && asset.fileName.endsWith(".css"),
			);
			const html = assets.find(
				(asset) => asset.type === "asset" && asset.fileName === "index.html",
			);
			if (css?.type !== "asset" || html?.type !== "asset") {
				throw new Error("Missing built stylesheet or page");
			}
			expect(String(css.source)).toContain(`color:${color}`);
			expect(String(css.source)).not.toContain("--stylex-sheet:");
			expect(String(html.source)).toContain(css.fileName);
			return css.fileName;
		};
		const redUrl = await compile("red");
		const blueUrl = await compile("blue");
		expect(blueUrl).not.toBe(redUrl);
		expect(await compile("blue")).toBe(blueUrl);
	} finally {
		await rm(fixture, { recursive: true, force: true });
	}
}, 30_000);
