import solid from "@solidjs/vite-plugin";
import stylex from "@stylexjs/unplugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
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
					return "vendor";
				},
			},
		},
	},
}));
