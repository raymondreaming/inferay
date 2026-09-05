export type TokenRange = {
	start: number;
	end: number;
};

export function findDecoratedTokenRanges(
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
