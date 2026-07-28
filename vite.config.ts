import { stylex } from "@octanejs/stylex/vite";
import { octane } from "@octanejs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import {
	DEV_FEATURE_FLAGS,
	PUBLISHED_FEATURE_FLAGS,
} from "./src/lib/feature-flags.ts";

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
		...octane().map(stripTransformSourceMaps),
		octaneStylexPlugin(),
		tailwindcss(),
	],
	define: {
		__INFERAY_FEATURE_FLAGS__: JSON.stringify(
			mode === "development" ? DEV_FEATURE_FLAGS : PUBLISHED_FEATURE_FLAGS
		),
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
		sourcemap: false,
		minify: false,
		rollupOptions: {
			output: {
				entryFileNames: "main.js",
				chunkFileNames: "assets/[name]-[hash].js",
				assetFileNames: "assets/[name]-[hash][extname]",
			},
		},
	},
}));
