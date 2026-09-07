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
	},
}));
