// Zero-dependency markdown-to-block parser with full inline formatting.

export interface MdBlock {
	type:
		| "heading"
		| "code"
		| "mermaid"
		| "blockquote"
		| "hr"
		| "table"
		| "ul"
		| "ol"
		| "checklist"
		| "paragraph";
	content: string;
	level?: number;
	lang?: string;
	rows?: string[][];
	items?: MdListItem[];
}

export interface MdListItem {
	content: string;
	checked?: boolean;
	indent: number;
	children: MdListItem[];
}

export interface MdInlineToken {
	type:
		| "text"
		| "bold"
		| "italic"
		| "bold-italic"
		| "strikethrough"
		| "code"
		| "link"
		| "image"
		| "linebreak";
	text: string;
	href?: string;
	alt?: string;
	children?: MdInlineToken[];
}

export function parseInline(src: string): MdInlineToken[] {
	const tokens: MdInlineToken[] = [];
	let remaining = src;

	while (remaining.length > 0) {
		// Line break (two trailing spaces or backslash before newline)
		const brMatch = remaining.match(/^( {2,}\n|\\n)/);
		if (brMatch) {
			tokens.push({ type: "linebreak", text: "" });
			remaining = remaining.slice(brMatch[0].length);
			continue;
		}

		// Image: ![alt](url)
		const imgMatch = remaining.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
		if (imgMatch) {
			tokens.push({
				type: "image",
				text: imgMatch[1]!,
				alt: imgMatch[1],
				href: imgMatch[2],
			});
			remaining = remaining.slice(imgMatch[0].length);
			continue;
		}

		// Link: [text](url)
		const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
		if (linkMatch) {
			tokens.push({
				type: "link",
				text: linkMatch[1]!,
				href: linkMatch[2],
				children: parseInline(linkMatch[1]!),
			});
			remaining = remaining.slice(linkMatch[0].length);
			continue;
		}

		// Inline code: `code`
		const codeMatch = remaining.match(/^`([^`]+)`/);
		if (codeMatch) {
			tokens.push({ type: "code", text: codeMatch[1]! });
			remaining = remaining.slice(codeMatch[0].length);
			continue;
		}

		// Bold-italic: ***text*** or ___text___
		const biMatch = remaining.match(/^(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/);
		if (biMatch) {
			tokens.push({
				type: "bold-italic",
				text: biMatch[2]!,
				children: parseInline(biMatch[2]!),
			});
			remaining = remaining.slice(biMatch[0].length);
			continue;
		}

		// Bold: **text** or __text__
		const boldMatch = remaining.match(/^(\*\*|__)(?=\S)([\s\S]*?\S)\1/);
		if (boldMatch) {
			tokens.push({
				type: "bold",
				text: boldMatch[2]!,
				children: parseInline(boldMatch[2]!),
			});
			remaining = remaining.slice(boldMatch[0].length);
			continue;
		}

		// Strikethrough: ~~text~~
		const strikeMatch = remaining.match(/^~~(?=\S)([\s\S]*?\S)~~/);
		if (strikeMatch) {
			tokens.push({
				type: "strikethrough",
				text: strikeMatch[1]!,
				children: parseInline(strikeMatch[1]!),
			});
			remaining = remaining.slice(strikeMatch[0].length);
			continue;
		}

		// Italic: *text* or _text_ (but not inside words for _)
		const italicMatch = remaining.match(/^(\*|_)(?=\S)([\s\S]*?\S)\1(?!\w)/);
		if (italicMatch) {
			tokens.push({
				type: "italic",
				text: italicMatch[2]!,
				children: parseInline(italicMatch[2]!),
			});
			remaining = remaining.slice(italicMatch[0].length);
			continue;
		}

		// Plain text — consume until next special character
		const textMatch = remaining.match(
			/^[\s\S](?:(?![*_`~![\\]| {2}\n)[\s\S])*/
		);
		if (textMatch) {
			tokens.push({ type: "text", text: textMatch[0] });
			remaining = remaining.slice(textMatch[0].length);
			continue;
		}

		// Fallback: consume one char
		tokens.push({ type: "text", text: remaining[0] ?? "" });
		remaining = remaining.slice(1);
	}

	return tokens;
}

function _parseListItems(
	lines: string[],
	startIndex: number,
	marker: RegExp
): { items: MdListItem[]; consumed: number } {
	const items: MdListItem[] = [];
	let i = startIndex;

	while (i < lines.length) {
		const line = lines[i];
		if (!line) break;
		const match = line.match(marker);
		if (!match) break;

		const indent = line.search(/\S/);
		const content = line.replace(marker, "");

		const item: MdListItem = {
			content,
			indent,
			children: [],
		};

		// Task list detection
		const taskMatch = content.match(/^\[([ xX])\]\s(.*)/);
		if (taskMatch) {
			item.checked = taskMatch[1] !== " ";
			item.content = taskMatch[2] ?? "";
		}

		items.push(item);
		i++;
	}

	return { items, consumed: i - startIndex };
}

export function parseBlocks(src: string): MdBlock[] {
	const lines = src.split("\n");
	const blocks: MdBlock[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];
		if (line === undefined) break;

		// Fenced code block
		if (/^`{3,}/.test(line)) {
			const fence = line.match(/^(`{3,})/)?.[0] ?? "```";
			const lang = line.slice(fence.length).trim();
			const codeLines: string[] = [];
			i++;
			while (i < lines.length && !lines[i]?.startsWith(fence)) {
				codeLines.push(lines[i] ?? "");
				i++;
			}
			if (i < lines.length) i++; // skip closing fence
			if (lang === "mermaid") {
				blocks.push({ type: "mermaid", content: codeLines.join("\n") });
			} else {
				blocks.push({ type: "code", content: codeLines.join("\n"), lang });
			}
			continue;
		}

		// Heading
		const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
		if (headingMatch) {
			blocks.push({
				type: "heading",
				level: headingMatch[1]!.length,
				content: headingMatch[2]!.replace(/\s+#+\s*$/, ""), // strip trailing #
			});
			i++;
			continue;
		}

		// Setext heading (underline style)
		if (
			i + 1 < lines.length &&
			line.trim() !== "" &&
			/^[=-]{2,}\s*$/.test(lines[i + 1]!)
		) {
			const level = lines[i + 1]?.startsWith("=") ? 1 : 2;
			blocks.push({ type: "heading", level, content: line.trim() });
			i += 2;
			continue;
		}

		// HR
		if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
			blocks.push({ type: "hr", content: "" });
			i++;
			continue;
		}

		// Table
		if (
			line.includes("|") &&
			i + 1 < lines.length &&
			/^\|?\s*[-:]+[-|:\s]+$/.test(lines[i + 1]!)
		) {
			const rows: string[][] = [];
			while (i < lines.length && lines[i]?.includes("|")) {
				const row = lines[i]!.replace(/^\||\|$/g, "")
					.split("|")
					.map((c) => c.trim());
				rows.push(row);
				i++;
			}
			// Remove separator row (index 1)
			if (rows.length > 1) rows.splice(1, 1);
			blocks.push({ type: "table", content: "", rows });
			continue;
		}

		// Blockquote
		if (line.startsWith("> ") || line === ">") {
			const bqLines: string[] = [];
			while (
				i < lines.length &&
				(lines[i]?.startsWith("> ") || lines[i] === ">")
			) {
				bqLines.push(lines[i]!.replace(/^>\s?/, ""));
				i++;
			}
			blocks.push({ type: "blockquote", content: bqLines.join("\n") });
			continue;
		}

		// Task list: - [ ] or - [x]
		if (/^[\s]*[-*+]\s\[[ xX]\]\s/.test(line)) {
			const { items, consumed } = _parseListItems(lines, i, /^[\s]*[-*+]\s/);
			blocks.push({
				type: "checklist",
				content: "",
				items,
			});
			i += consumed;
			continue;
		}

		// Unordered list
		if (/^[\s]*[-*+]\s/.test(line)) {
			const { items, consumed } = _parseListItems(lines, i, /^[\s]*[-*+]\s/);
			blocks.push({ type: "ul", content: "", items });
			i += consumed;
			continue;
		}

		// Ordered list
		if (/^[\s]*\d+[.)]\s/.test(line)) {
			const { items, consumed } = _parseListItems(lines, i, /^[\s]*\d+[.)]\s/);
			blocks.push({ type: "ol", content: "", items });
			i += consumed;
			continue;
		}

		// Empty line
		if (line.trim() === "") {
			i++;
			continue;
		}

		// Paragraph
		const pLines: string[] = [];
		while (
			i < lines.length &&
			lines[i]?.trim() !== "" &&
			!/^`{3,}/.test(lines[i]!) &&
			!/^#{1,6}\s/.test(lines[i]!) &&
			!/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]!) &&
			!/^>\s/.test(lines[i]!) &&
			!/^[\s]*[-*+]\s/.test(lines[i]!) &&
			!/^[\s]*\d+[.)]\s/.test(lines[i]!) &&
			!(lines[i]?.includes("|") && lines[i + 1]?.match(/^\|?\s*[-:]+[-|:\s]+$/))
		) {
			pLines.push(lines[i]!);
			i++;
		}
		if (pLines.length > 0) {
			blocks.push({ type: "paragraph", content: pLines.join("\n") });
		}
	}

	return blocks;
}
