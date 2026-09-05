import { lazy } from "octane";

export const LazyLiquidPanelSurface = lazy(() =>
	import("../LiquidPanelSurface/index.tsx").then((module) => ({
		default: module.LiquidPanelSurface,
	})),
);
