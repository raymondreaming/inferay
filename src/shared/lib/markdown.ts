/** Prepared native Markdown wire model. Parsing belongs to the Rust server. */
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
	tokens?: MdInlineToken[];
	level?: number;
	lang?: string;
	rows?: MdInlineToken[][][];
	items?: MdListItem[];
	children?: MdBlock[];
}

export interface MdListItem {
	bullet?: string;
	content: string;
	tokens: MdInlineToken[];
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
		| "linebreak"
		| "markdown_path"
		| "url";
	text: string;
	href?: string;
	alt?: string;
	children?: MdInlineToken[];
}

export interface PreparedMarkdown {
	version: 1;
	blocks: MdBlock[];
}
