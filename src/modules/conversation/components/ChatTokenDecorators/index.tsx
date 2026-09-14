import type { DecoratedTextSegment } from "@contracts";
import { project as rustProject } from "@shared/lib/native.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, For, Show } from "solid-js";
import { styles } from "./styles.ts";

type DecoratedTextProps = {
	text: string;
	slashCommandNames?: readonly string[];
	pills?: boolean;
};

/** Keep segment elements alive as their text changes during typing or edits. */
export function DecoratedText(props: DecoratedTextProps) {
	const segments = createMemo(() =>
		decoratedTextSegments(props.text, props.slashCommandNames),
	);
	return (
		<For each={segments()} keyed={false}>
			{(segment) => (
				<span
					{...stylex.attrs(
						segment().highlighted
							? props.pills
								? styles.pill
								: styles.highlight
							: props.pills
								? null
								: styles.text,
					)}
				>
					{segment().text}
				</span>
			)}
		</For>
	);
}

export function InputHighlights(props: Omit<DecoratedTextProps, "pills">) {
	return (
		<Show
			when={props.text.length > 0}
			fallback={<span {...stylex.attrs(styles.transparent)}>{"\u00A0"}</span>}
		>
			<DecoratedText
				text={props.text}
				slashCommandNames={props.slashCommandNames}
			/>
		</Show>
	);
}

export function decoratedTextSegments(
	text: string,
	slashCommandNames?: readonly string[],
): DecoratedTextSegment[] {
	return rustProject("decoratedTextSegments", {
		text,
		commands: slashCommandNames,
	});
}
