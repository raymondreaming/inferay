import * as stylex from "@octanejs/stylex";
import {
	color,
	controlSize,
	effect,
	font,
	radius,
} from "../../../tokens.stylex.ts";

type TokenRange = {
	start: number;
	end: number;
};

function findDecoratedTokenRanges(
	text: string,
	slashCommandNames?: readonly string[],
): TokenRange[] {
	if (!text) return [];

	const ranges: TokenRange[] = [];
	const slashRegex = /(^|\s)(\/[a-zA-Z][\w-]*)/g;
	const fileRegex = /(^|\s)(@[^\s]+)/g;
	const knownSlashCommands = slashCommandNames
		? new Set(slashCommandNames.map((name) => name.toLowerCase()))
		: null;

	for (
		let match = slashRegex.exec(text);
		match;
		match = slashRegex.exec(text)
	) {
		const prefix = match[1]!;
		const token = match[2]!;
		if (!knownSlashCommands?.has(token.slice(1).toLowerCase())) continue;
		const start = match.index + prefix.length;
		ranges.push({ start, end: start + token.length });
	}

	for (let match = fileRegex.exec(text); match; match = fileRegex.exec(text)) {
		const prefix = match[1]!;
		const token = match[2]!;
		const start = match.index + prefix.length;
		ranges.push({ start, end: start + token.length });
	}

	ranges.sort((a, b) => a.start - b.start);
	return ranges;
}

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

const styles = stylex.create({
	transparent: {
		color: color.transparent,
	},
	text: {
		color: color.textMain,
	},
	highlight: {
		backgroundColor: effect.tokenHighlightBackground,
		borderRadius: radius.xs,
		color: color.accent,
	},
	pill: {
		alignItems: "center",
		alignSelf: "center",
		backgroundColor: effect.tokenHighlightBackground,
		borderRadius: radius.pill,
		color: color.accent,
		display: "inline-flex",
		fontSize: font.size_3,
		fontWeight: font.weight_5,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._1_5,
		verticalAlign: "middle",
	},
});
