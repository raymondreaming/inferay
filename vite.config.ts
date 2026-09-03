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

function octaneStylexPlugin(): Plugin {
	return stripTransformSourceMaps(stylex({ useCSSLayers: true }) as Plugin);
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
