import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import { project as rustProject } from "../../../../shared/lib/native.tsx";
import { styles } from "./styles.ts";
export function renderInputHighlights(
	text: string,
	slashCommandNames?: readonly string[],
): import("solid-js").Element {
	if (!text)
		return <span {...stylex.attrs(styles.transparent)}>{"\u00A0"}</span>;
	const tokens = createMemo(() =>
		findDecoratedTokenRanges(text, slashCommandNames),
	);
	if (tokens().length === 0) {
		return <span {...stylex.attrs(styles.text)}>{text}</span>;
	}
	const segments = createMemo<import("solid-js").Element[]>(() => []);
	let lastEnd = 0;
	for (const token of tokens()) {
		if (token.start < lastEnd) continue;
		if (token.start > lastEnd) {
			segments().push(
				<span {...stylex.attrs(styles.text)}>
					{text.slice(lastEnd, token.start)}
				</span>,
			);
		}
		const tokenText = text.slice(token.start, token.end);
		segments().push(
			<span {...stylex.attrs(styles.highlight)}>{tokenText}</span>,
		);
		lastEnd = token.end;
	}
	if (lastEnd < text.length) {
		segments().push(
			<span {...stylex.attrs(styles.text)}>{text.slice(lastEnd)}</span>,
		);
	}
	return <>{segments()}</>;
}
export function renderTextPills(
	text: string,
	slashCommandNames?: readonly string[],
): import("solid-js").Element[] {
	if (!text) return [];
	const matches = createMemo(() =>
		findDecoratedTokenRanges(text, slashCommandNames),
	);
	if (matches().length === 0) return [text];
	const parts = createMemo<import("solid-js").Element[]>(() => []);
	let lastEnd = 0;
	for (const token of matches()) {
		if (token.start < lastEnd) continue;
		if (token.start > lastEnd) {
			parts().push(text.slice(lastEnd, token.start));
		}
		const tokenText = text.slice(token.start, token.end);
		parts().push(<span {...stylex.attrs(styles.pill)}>{tokenText}</span>);
		lastEnd = token.end;
	}
	if (lastEnd < text.length) {
		parts().push(text.slice(lastEnd));
	}
	return parts();
}
type TokenRange = {
	start: number;
	end: number;
};
export function findDecoratedTokenRanges(
	text: string,
	slashCommandNames?: readonly string[],
): TokenRange[] {
	return rustProject("decoratedTokens", {
		text,
		commands: slashCommandNames,
	});
}
