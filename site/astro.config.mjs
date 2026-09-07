// @ts-check

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import solidPages from "./integrations/solid/index.mjs";

const tailwindPlugin = /** @type {any} */ (tailwindcss());

// https://astro.build/config
export default defineConfig({
	integrations: [solidPages()],
	vite: {
		plugins: [tailwindPlugin],
	},
});
