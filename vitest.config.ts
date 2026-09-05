import { stylex } from "@octanejs/stylex/vite";
import { octane } from "octane/compiler/vite";
import { defineConfig, type Plugin } from "vitest/config";

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

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^octane$/,
				replacement: new URL(
					"./node_modules/octane/dist/index.js",
					import.meta.url,
				).pathname,
			},
		],
	},
	plugins: [
		// Compiler plugins use the application Vite types; Vitest bundles its own.
		stripTransformSourceMaps(
			octane({ hmr: false, ssr: false }) as unknown as Plugin,
		),
		stripTransformSourceMaps(stylex({ useCSSLayers: true }) as Plugin),
	],
	test: {
		environment: "node",
		include: ["tests/**/*.octane.{ts,tsx}"],
		setupFiles: ["./tests/octane.setup.ts"],
	},
});
