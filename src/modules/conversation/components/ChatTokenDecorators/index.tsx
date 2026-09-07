import * as stylex from "@stylexjs/stylex";
import { createMemo, For, Show } from "solid-js";
import { project as rustProject } from "../../../../shared/lib/native.tsx";
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
) {
	const segments: Array<{ text: string; highlighted: boolean }> = [];
	let lastEnd = 0;
	for (const token of findDecoratedTokenRanges(text, slashCommandNames)) {
		if (token.start < lastEnd) continue;
		if (token.start > lastEnd)
			segments.push({
				text: text.slice(lastEnd, token.start),
				highlighted: false,
			});
		segments.push({
			text: text.slice(token.start, token.end),
			highlighted: true,
		});
		lastEnd = token.end;
	}
	if (lastEnd < text.length)
		segments.push({ text: text.slice(lastEnd), highlighted: false });
	return segments;
}

type TokenRange = { start: number; end: number };
export function findDecoratedTokenRanges(
	text: string,
	slashCommandNames?: readonly string[],
): TokenRange[] {
	return rustProject("decoratedTokens", { text, commands: slashCommandNames });
}
