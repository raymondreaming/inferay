import * as stylex from "@stylexjs/stylex";
import { createEffect } from "solid-js";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import { styles } from "./styles.ts";
export function ChatPaneRecovery(_props: {
	error: unknown;
	reset: () => void;
}) {
	createEffect(
		() => [_props.error],
		() => {
			console.error("[chat] Chat pane render failed:", _props.error);
		},
	);
	return (
		<div {...stylex.attrs(styles.root)} role="alert">
			<div {...stylex.attrs(styles.card)}>
				<div {...stylex.attrs(styles.title)}>This chat pane hit a problem.</div>
				<div {...stylex.attrs(styles.message)}>
					The rest of your workspace is still available.
				</div>
				<Button
					type="button"
					onClick={_props.reset}
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
