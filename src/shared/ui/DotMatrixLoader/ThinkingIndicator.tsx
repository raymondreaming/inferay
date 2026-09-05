import * as stylex from "@octanejs/stylex";
import { useEffect, useState } from "octane";
import { formatElapsedMs } from "../../lib/format.ts";
import { DotMatrixRipple } from "./DotMatrixRipple.tsx";
import { styles } from "./styles.ts";

export function ThinkingIndicator({ startTime }: { startTime: number }) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, []);
	const elapsed = formatElapsedMs(now - startTime);
	return (
		<output
			{...stylex.props(styles.thinkingRow)}
			aria-live="polite"
			aria-label={`Agent active, ${elapsed} elapsed`}
		>
			<DotMatrixRipple />
			<span {...stylex.props(styles.thinkingTime)}>{elapsed}</span>
		</output>
	);
}
