import { Suspense, useEffect, useState } from "octane";
import type { ReactNode } from "../../../../types/octane-react-compat.ts";
import { LazyLiquidPanelSurface } from "./shared.ts";

export function LiquidPanel({
	children,
	fill,
}: {
	children?: ReactNode;
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
