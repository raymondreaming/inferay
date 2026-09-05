import * as stylex from "@octanejs/stylex";
import { findDecoratedTokenRanges } from "../../model/agent-chat-shared.ts";
import { styles } from "./styles.ts";

export function renderInputHighlights(
	text: string,
	slashCommandNames?: readonly string[],
): unknown {
	if (!text)
		return <span {...stylex.props(styles.transparent)}>{"\u00A0"}</span>;

	const tokens = findDecoratedTokenRanges(text, slashCommandNames);
	if (tokens.length === 0) {
		return <span {...stylex.props(styles.text)}>{text}</span>;
	}

	const segments: unknown[] = [];
	let lastEnd = 0;

	for (const token of tokens) {
		if (token.start < lastEnd) continue;

		if (token.start > lastEnd) {
			segments.push(
				<span key={`t-${lastEnd}`} {...stylex.props(styles.text)}>
					{text.slice(lastEnd, token.start)}
				</span>,
			);
		}

		const tokenText = text.slice(token.start, token.end);
		segments.push(
			<span key={`h-${token.start}`} {...stylex.props(styles.highlight)}>
				{tokenText}
			</span>,
		);
		lastEnd = token.end;
	}

	if (lastEnd < text.length) {
		segments.push(
			<span key={`t-${lastEnd}`} {...stylex.props(styles.text)}>
				{text.slice(lastEnd)}
			</span>,
		);
	}

	return <>{segments}</>;
}

export function renderTextPills(
	text: string,
	slashCommandNames?: readonly string[],
): unknown[] {
	if (!text) return [];

	const matches = findDecoratedTokenRanges(text, slashCommandNames);
	if (matches.length === 0) return [text];

	const parts: unknown[] = [];
	let lastEnd = 0;

	for (const token of matches) {
		if (token.start < lastEnd) continue;

		if (token.start > lastEnd) {
			parts.push(text.slice(lastEnd, token.start));
		}

		const tokenText = text.slice(token.start, token.end);
		parts.push(
			<span key={`${token.start}-${tokenText}`} {...stylex.props(styles.pill)}>
				{tokenText}
			</span>,
		);
		lastEnd = token.end;
	}

	if (lastEnd < text.length) {
		parts.push(text.slice(lastEnd));
	}

	return parts;
}

export type { TokenRange } from "../../model/agent-chat-shared.ts";
export { findDecoratedTokenRanges } from "../../model/agent-chat-shared.ts";
export { styles } from "./styles.ts";
