export type InlineToken =
	| { type: "text"; value: string }
	| { type: "code"; value: string }
	| { type: "bold"; value: string }
	| { type: "italic"; value: string }
	| { type: "markdown_link"; label: string; href: string }
	| { type: "markdown_path"; value: string }
	| { type: "url"; value: string; href: string };

export type MarkdownBlock =
	| { type: "paragraph"; content: string }
	| { type: "code"; content: string }
	| { type: "heading"; content: string; level: number }
	| { type: "list-item"; content: string; bullet: string }
	| { type: "table"; headers: string[]; rows: string[][] };

const INLINE_TOKEN_REGEX =
	/(`[^`\n]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)<>]+|[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}[^\s)<>]*|[\w./-]+\.md\b)/g;

export function parseInlineTokens(text: string): InlineToken[] {
	if (!text) return [];
	const parts = text.split(INLINE_TOKEN_REGEX);
	const tokens: InlineToken[] = [];

	for (const part of parts) {
		if (!part) continue;
		if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
			tokens.push({ type: "code", value: part.slice(1, -1) });
			continue;
		}
		if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
			tokens.push({ type: "bold", value: part.slice(2, -2) });
			continue;
		}
		if (
			part.startsWith("*") &&
			part.endsWith("*") &&
			!part.startsWith("**") &&
			part.length > 2
		) {
			tokens.push({ type: "italic", value: part.slice(1, -1) });
			continue;
		}
		const markdownLink = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
		if (markdownLink) {
			tokens.push({
				type: "markdown_link",
				label: markdownLink[1]!,
				href: markdownLink[2]!,
			});
			continue;
		}
		if (/\.md$/i.test(part)) {
			tokens.push({ type: "markdown_path", value: part });
			continue;
		}
		if (/^https?:\/\//.test(part)) {
			tokens.push({ type: "url", value: part, href: part });
			continue;
		}
		if (/^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}/.test(part)) {
			tokens.push({ type: "url", value: part, href: `https://${part}` });
			continue;
		}
		tokens.push({ type: "text", value: part });
	}

	return tokens;
}

export function parseMarkdownBlocks(
	text: string,
	streaming = false,
): MarkdownBlock[] {
	const blocks: MarkdownBlock[] = [];
	const lines = text.split("\n");
	let i = 0;

	while (i < lines.length) {
		const line = lines[i]!;
		if (line.trimStart().startsWith("```")) {
			const code: string[] = [];
			i++;
			while (i < lines.length && !lines[i]?.trimStart().startsWith("```")) {
				code.push(lines[i]!);
				i++;
			}
			i++;
			blocks.push({ type: "code", content: code.join("\n") });
			continue;
		}

		const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
		if (headingMatch) {
			blocks.push({
				type: "heading",
				content: headingMatch[2] ?? "",
				level: headingMatch[1]?.length ?? 1,
			});
			i++;
			continue;
		}

		const listMatch = line.match(/^(\s*(?:[-*]|\d+\.)\s+)(.+)/);
		if (listMatch) {
			blocks.push({
				type: "list-item",
				content: listMatch[2] ?? "",
				bullet: listMatch[1]?.trim() ?? "-",
			});
			i++;
			continue;
		}

		const trimmedLine = line.trim();
		if (
			trimmedLine.startsWith("|") &&
			(trimmedLine.endsWith("|") || (streaming && i < lines.length - 1))
		) {
			const tableLines: string[] = [line];
			i++;
			while (
				i < lines.length &&
				lines[i]?.trim().startsWith("|") &&
				(streaming || lines[i]?.trim().endsWith("|"))
			) {
				tableLines.push(lines[i]!);
				i++;
			}
			if (tableLines.length >= 2 || streaming) {
				const parseCells = (row: string) => {
					const cells = row.split("|");
					if (cells[0]?.trim() === "") cells.shift();
					if (cells.at(-1)?.trim() === "") cells.pop();
					return cells.map((cell) => cell.trim());
				};
				const headers = parseCells(tableLines[0]!);
				const separatorCells = tableLines[1] ? parseCells(tableLines[1]) : [];
				const hasSeparator =
					separatorCells.length > 0 &&
					separatorCells.every((cell) => /^:?-+:?$/.test(cell));
				const startRow = hasSeparator ? 2 : 1;
				const rows = tableLines.slice(startRow).map(parseCells);
				blocks.push({ type: "table", headers, rows });
			} else {
				blocks.push({ type: "paragraph", content: tableLines.join("\n") });
			}
			continue;
		}

		if (!line.trim()) {
			i++;
			continue;
		}

		const paragraph: string[] = [line];
		i++;
		while (
			i < lines.length &&
			lines[i]?.trim() &&
			!lines[i]?.trimStart().startsWith("```") &&
			!lines[i]?.match(/^#{1,4}\s+/) &&
			!lines[i]?.match(/^\s*(?:[-*]|\d+\.)\s+/)
		) {
			paragraph.push(lines[i]!);
			i++;
		}
		blocks.push({ type: "paragraph", content: paragraph.join("\n") });
	}

	return blocks;
}
