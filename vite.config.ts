import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stylex } from "@octanejs/stylex/vite";
import { tanstackStart } from "@octanejs/tanstack-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import {
	DEV_FEATURE_FLAGS,
	PUBLISHED_FEATURE_FLAGS,
} from "./src/shared/lib/feature-flags.ts";

function stripTransformSourceMaps(plugin: Plugin): Plugin {
	const transform = plugin.transform;
	if (typeof transform === "function") {
		plugin.transform = async function (code, id, options) {
			const result = await transform.call(this, code, id, options);
			return result && typeof result === "object"
				? { ...result, map: null }
				: result;
		};
	}
	return plugin;
}

export function octaneStylexPlugin(): Plugin {
	const plugin = stylex({ useCSSLayers: true }) as Plugin;
	const configResolved = plugin.configResolved;
	let sourceDirectory = "";
	plugin.configResolved = async function (config) {
		sourceDirectory = join(config.root, "src");
		if (typeof configResolved === "function") {
			await configResolved.call(this, config);
		}
	};
	const load = plugin.load;
	if (typeof load === "function") {
		plugin.load = async function (id, options) {
			const result = await load.call(this, id, options);
			if (
				id !== "\0virtual:stylex.css" ||
				typeof result !== "string" ||
				!result.includes("--stylex-sheet:1")
			) {
				return result;
			}
			// StyleX injects its final CSS in generateBundle, after Vite hashes
			// assets. Fingerprint the source in its placeholder so immutable
			// stylesheet URLs change when rules or cross-file token names change.
			const hash = createHash("sha256");
			for (const path of readdirSync(sourceDirectory, {
				recursive: true,
				encoding: "utf8",
			})
				.filter((path) => /\.(?:tsx?|jsx?|css)$/.test(path))
				.sort()) {
				hash.update(path);
				hash.update("\0");
				hash.update(readFileSync(join(sourceDirectory, path)));
				hash.update("\0");
			}
			return result.replace(
				"--stylex-sheet:1",
				`--stylex-sheet:${hash.digest("hex")}`,
			);
		};
	}
	return stripTransformSourceMaps(plugin);
}

export default defineConfig(({ mode }) => ({
	plugins: [
		...tanstackStart({
			spa: {
				enabled: true,
				prerender: { outputPath: "/index.html" },
			},
			client: { entry: "client", base: "/assets" },
			sitemap: { enabled: false },
			octane: { devtools: mode === "development" },
		}).map((plugin) =>
			plugin && typeof plugin === "object"
				? stripTransformSourceMaps(plugin as Plugin)
				: plugin,
		),
		octaneStylexPlugin(),
		tailwindcss(),
	],
	define: {
		__INFERAY_FEATURE_FLAGS__: JSON.stringify(
			mode === "development" ? DEV_FEATURE_FLAGS : PUBLISHED_FEATURE_FLAGS,
		),
	},
	build: {
		sourcemap: false,
		minify: mode === "development" ? false : "oxc",
	},
	environments: {
		client: { build: { outDir: "dist" } },
		ssr: { build: { outDir: ".tanstack-start/server" } },
	},
}));
