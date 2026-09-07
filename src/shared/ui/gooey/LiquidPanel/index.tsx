import { type OctaneNode, Suspense, useEffect, useState } from "octane";

export function LiquidPanel({
	children,
	fill,
}: {
	children?: OctaneNode;
	fill: string;
}) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	if (!mounted) return children;
	return (
		<Suspense fallback={children}>
			<LazyLiquidPanelSurface fill={fill}>{children}</LazyLiquidPanelSurface>
		</Suspense>
	);
}

import { lazy } from "octane";

const LazyLiquidPanelSurface = lazy(() =>
	import("../LiquidPanelSurface/index.tsx").then((module) => ({
		default: module.LiquidPanelSurface,
	})),
);
