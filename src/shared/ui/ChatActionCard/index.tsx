import * as stylex from "@stylexjs/stylex";
import { createSignal } from "solid-js";
import { Button } from "../Button/index.tsx";
import { cardStyles } from "./styles.ts";
export function CardInstructions(props: { text: string; label?: string }) {
	const [expanded, setExpanded] = createSignal(false);
	return (
		<div {...stylex.attrs(cardStyles.instructions)}>
			<p
				{...stylex.attrs(cardStyles.preview, expanded() && cardStyles.expanded)}
			>
				{props.text}
			</p>
			<Button
				size="sm"
				variant="ghost"
				aria-expanded={expanded() ? "true" : "false"}
				onClick={() => setExpanded(!expanded())}
			>
				{expanded() ? "Less" : props.label || "View instructions"}
			</Button>
		</div>
	);
}
