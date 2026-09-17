import { fileURLToPath, URL } from "node:url";
import solid from "@solidjs/vite-plugin";
import stylex from "@stylexjs/unplugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
	resolve: {
		alias: {
			"@app": fileURLToPath(new URL("./src/app", import.meta.url)),
			"@agents": fileURLToPath(
				new URL("./src/modules/agents", import.meta.url),
			),
			"@context": fileURLToPath(
				new URL("./src/modules/context", import.meta.url),
			),
			"@conversation": fileURLToPath(
				new URL("./src/modules/conversation", import.meta.url),
			),
			"@design-system": fileURLToPath(
				new URL("./src/design-system", import.meta.url),
			),
			"@explorer": fileURLToPath(
				new URL("./src/modules/explorer", import.meta.url),
			),
			"@onboarding": fileURLToPath(
				new URL("./src/modules/onboarding", import.meta.url),
			),
			"@repository": fileURLToPath(
				new URL("./src/modules/repository", import.meta.url),
			),
			"@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
			"@settings": fileURLToPath(
				new URL("./src/modules/settings", import.meta.url),
			),
			"@skills": fileURLToPath(
				new URL("./src/modules/skills", import.meta.url),
			),
			"@workspace": fileURLToPath(
				new URL("./src/modules/workspace", import.meta.url),
			),
		},
	},
	plugins: [
		stylex.vite({
			useCSSLayers: true,
			cssInjectionTarget: (file) => /(?:^|\/)index-[^/]+\.css$/.test(file),
		}),
		solid(),
		tailwindcss(),
	],
	build: {
		outDir: "dist",
		sourcemap: false,
		minify: mode === "development" ? false : "oxc",
		rollupOptions: {
			output: {
				// Without this, Rollup attributed shared vendor code to whichever
				// UI primitive first imported it: LiquidItem is 8KB of source but
				// owned a 788KB chunk holding TanStack Query and the wasm-bindgen
				// glue, so opening any of the nine views that import it parsed all
				// of it. Splitting by owner keeps a primitive's chunk the size of
				// the primitive.
				manualChunks(id) {
					if (!id.includes("node_modules")) return;
					if (id.includes("@tanstack")) return "vendor-query";
					if (id.includes("solid-js") || id.includes("@solidjs"))
						return "vendor-solid";
					if (id.includes("syntect") || id.includes("shiki"))
						return "vendor-highlight";
					return undefined;
				},
			},
		},
	},
}));
