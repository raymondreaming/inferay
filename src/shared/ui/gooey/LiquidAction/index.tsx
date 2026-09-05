import type { ReactNode } from "../../../../types/octane-react-compat.ts";
import { LiquidActionSurface } from "../LiquidActionSurface/index.tsx";

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
