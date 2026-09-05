import * as stylex from "@octanejs/stylex";
import { useEffect } from "octane";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import { styles } from "./styles.ts";

export function ChatPaneRecovery({
	error,
	reset,
}: {
	error: unknown;
	reset: () => void;
}) {
	useEffect(() => {
		console.error("[chat] Chat pane render failed:", error);
	}, [error]);

	return (
		<div {...stylex.props(styles.root)} role="alert">
			<div {...stylex.props(styles.card)}>
				<div {...stylex.props(styles.title)}>This chat pane hit a problem.</div>
				<div {...stylex.props(styles.message)}>
					The rest of your workspace is still available.
				</div>
				<Button
					type="button"
					onClick={reset}
					variant="secondary"
					size="sm"
					liquid={false}
				>
					Reload pane
				</Button>
			</div>
		</div>
	);
}
