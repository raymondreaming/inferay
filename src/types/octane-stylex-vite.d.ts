declare module "@octanejs/stylex/vite" {
	import type { Plugin } from "vite";

	export interface StylexOptions {
		include?: RegExp;
		importSources?: Array<string | { from: string; as: string }>;
		dev?: boolean;
		useCSSLayers?: boolean;
		unstable_moduleResolution?: Record<string, unknown>;
		stylexOptions?: Record<string, unknown>;
	}

	export function stylex(options?: StylexOptions): Plugin;
}

declare module "virtual:stylex.css";
