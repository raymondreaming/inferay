import { LiquidActionSurface } from "../LiquidActionSurface/index.tsx";
import type { ReactNode } from "../observer.ts";
export interface LiquidActionProps {
	children?: ReactNode;
	fill: string;
	fullWidth?: boolean;
	intense?: boolean;
}
export function LiquidAction({
	children,
	fill,
	fullWidth = false,
	intense = false,
}: LiquidActionProps) {
	return (
		<LiquidActionSurface fill={fill} fullWidth={fullWidth} intense={intense}>
			{children}
		</LiquidActionSurface>
	);
}
