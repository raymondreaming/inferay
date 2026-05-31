import * as stylex from "@stylexjs/stylex";
import { memo, useEffect, useRef, useState } from "react";
import {
	type MdBlock,
	type MdInlineToken,
	type MdListItem,
	parseBlocks,
	parseInline,
} from "../../lib/markdown.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";

let mermaidPromise: Promise<unknown> | null = null;
function loadMermaid(): Promise<unknown> {
	if (mermaidPromise) return mermaidPromise;
	mermaidPromise = new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
		script.onload = () => {
			const m = (window as unknown as Record<string, unknown>).mermaid as {
				initialize: (cfg: Record<string, unknown>) => void;
			};
			m.initialize({
				startOnLoad: false,
				theme: "dark",
				themeVariables: {
					darkMode: true,
					background: "transparent",
					primaryColor: "var(--color-inferay-gray-border)",
					primaryTextColor: "var(--color-inferay-soft-white)",
					primaryBorderColor: "var(--color-inferay-gray-border-bold)",
					lineColor: "var(--color-inferay-muted-gray)",
					secondaryColor: "var(--color-inferay-gray)",
					tertiaryColor: "var(--color-inferay-dark-gray)",
					fontFamily: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
					fontSize: "11px",
				},
			});
			resolve(m);
		};
		script.onerror = reject;
		document.head.appendChild(script);
	});
	return mermaidPromise;
}

function MermaidBlock({ code }: { code: string }) {
	const ref = useRef<HTMLDivElement>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		const { signal } = controller;
		const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		loadMermaid()
			.then(() => {
				if (signal.aborted || !ref.current) return;
				const m = (window as unknown as Record<string, unknown>).mermaid as {
					render: (id: string, code: string) => Promise<{ svg: string }>;
				};
				return m.render(id, code);
			})
			.then((result) => {
				if (signal.aborted || !ref.current || !result) return;
				ref.current.innerHTML = result.svg;
			})
			.catch((err) => {
				if (!signal.aborted) setError(String(err));
			});
		return controller.abort.bind(controller);
	}, [code]);

	if (error)
		return (
			<div {...stylex.props(styles.mermaidBox)}>
				<pre {...stylex.props(styles.errorPre)}>{error}</pre>
			</div>
		);

	return (
		<div ref={ref} {...stylex.props(styles.mermaidBox, styles.mermaidRender)} />
	);
}

function InlineTokens({ tokens }: { tokens: MdInlineToken[] }) {
	return (
		<>
			{tokens.map((tok, i) => (
				<InlineToken key={i} token={tok} />
			))}
		</>
	);
}

function InlineToken({ token }: { token: MdInlineToken }) {
	switch (token.type) {
		case "linebreak":
			return <br />;

		case "image":
			return (
				<img
					src={token.href}
					alt={token.alt ?? ""}
					{...stylex.props(styles.image)}
				/>
			);

		case "link":
			return (
				<a
					href={token.href}
					{...stylex.props(styles.link)}
					target="_blank"
					rel="noopener noreferrer"
				>
					{token.children ? (
						<InlineTokens tokens={token.children} />
					) : (
						token.text
					)}
				</a>
			);

		case "code":
			return <code {...stylex.props(styles.inlineCode)}>{token.text}</code>;

		case "bold-italic":
			return (
				<strong {...stylex.props(styles.strongBold)}>
					<em {...stylex.props(styles.italic)}>
						{token.children ? (
							<InlineTokens tokens={token.children} />
						) : (
							token.text
						)}
					</em>
				</strong>
			);

		case "bold":
			return (
				<strong {...stylex.props(styles.strong)}>
					{token.children ? (
						<InlineTokens tokens={token.children} />
					) : (
						token.text
					)}
				</strong>
			);

		case "italic":
			return (
				<em {...stylex.props(styles.italic)}>
					{token.children ? (
						<InlineTokens tokens={token.children} />
					) : (
						token.text
					)}
				</em>
			);

		case "strikethrough":
			return (
				<del {...stylex.props(styles.deleted)}>
					{token.children ? (
						<InlineTokens tokens={token.children} />
					) : (
						token.text
					)}
				</del>
			);
		default:
			return <>{token.text}</>;
	}
}

function Inline({ text }: { text: string }) {
	const tokens = parseInline(text);
	return <InlineTokens tokens={tokens} />;
}

function ListItemRenderer({ item }: { item: MdListItem }) {
	return (
		<li {...stylex.props(styles.listItem)}>
			{item.checked !== undefined && (
				<span {...stylex.props(styles.checkSlot)}>
					{item.checked ? (
						<span {...stylex.props(styles.checkOn)}>✓</span>
					) : (
						<span {...stylex.props(styles.checkOff)} />
					)}
				</span>
			)}
			<Inline text={item.content} />
			{item.children.length > 0 && (
				<ul {...stylex.props(styles.nestedList)}>
					{item.children.map((child, j) => (
						<ListItemRenderer key={j} item={child} />
					))}
				</ul>
			)}
		</li>
	);
}

function renderListItem(item: MdListItem, key: number) {
	return <ListItemRenderer key={key} item={item} />;
}

function BlockRenderer({ block }: { block: MdBlock }) {
	switch (block.type) {
		case "heading":
			return (
				<div
					{...stylex.props(
						styles.heading,
						block.level === 1 && styles.heading1,
						block.level === 2 && styles.heading2,
						block.level === 3 && styles.heading3,
						block.level === 4 && styles.heading4,
						block.level === 5 && styles.heading5,
						block.level === 6 && styles.heading6
					)}
				>
					<Inline text={block.content} />
				</div>
			);

		case "mermaid":
			return <MermaidBlock code={block.content} />;

		case "code":
			return (
				<div {...stylex.props(styles.codeBlock)}>
					{block.lang && (
						<span {...stylex.props(styles.codeLang)}>{block.lang}</span>
					)}
					<pre {...stylex.props(styles.pre)}>
						<code {...stylex.props(styles.codeText)}>{block.content}</code>
					</pre>
				</div>
			);

		case "blockquote": {
			const innerBlocks = parseBlocks(block.content);
			return (
				<div {...stylex.props(styles.blockquote)}>
					{innerBlocks.map((inner, j) => (
						<BlockRenderer key={j} block={inner} />
					))}
				</div>
			);
		}

		case "hr":
			return <hr {...stylex.props(styles.hr)} />;

		case "table":
			if (!block.rows?.length) return null;
			return (
				<div {...stylex.props(styles.tableWrap)}>
					<table {...stylex.props(styles.table)}>
						<thead>
							<tr {...stylex.props(styles.tableHeadRow)}>
								{block.rows[0]?.map((cell, j) => (
									<th key={j} {...stylex.props(styles.tableHeadCell)}>
										<Inline text={cell} />
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{block.rows.slice(1).map((row, k) => (
								<tr key={k} {...stylex.props(styles.tableRow)}>
									{row.map((cell, j) => (
										<td key={j} {...stylex.props(styles.tableCell)}>
											<Inline text={cell} />
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);

		case "checklist":
			return (
				<ul {...stylex.props(styles.checklist)}>
					{(block.items ?? []).map(renderListItem)}
				</ul>
			);

		case "ul":
			return (
				<ul {...stylex.props(styles.unorderedList)}>
					{(block.items ?? []).map(renderListItem)}
				</ul>
			);

		case "ol":
			return (
				<ol {...stylex.props(styles.orderedList)}>
					{(block.items ?? []).map(renderListItem)}
				</ol>
			);

		case "paragraph":
			return (
				<p {...stylex.props(styles.paragraph)}>
					<Inline text={block.content} />
				</p>
			);
	}
}

export const MarkdownPreview = memo(function MarkdownPreview({
	content,
}: {
	content: string;
}) {
	const blocks = parseBlocks(content);
	return (
		<div {...stylex.props(styles.root)}>
			{blocks.map((block, i) => (
				<BlockRenderer key={i} block={block} />
			))}
		</div>
	);
});

const styles = stylex.create({
	root: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._3,
	},
	mermaidBox: {
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: "0.375rem",
		backgroundColor: color.backgroundRaised,
		padding: controlSize._3,
	},
	mermaidRender: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		overflowX: "auto",
		padding: controlSize._4,
	},
	errorPre: {
		color: color.danger,
		fontSize: font.size_2,
		whiteSpace: "pre-wrap",
	},
	image: {
		display: "inline-block",
		maxWidth: "100%",
		borderRadius: "0.375rem",
		marginBlock: controlSize._1,
	},
	link: {
		color: color.accent,
		textDecorationLine: "underline",
		textDecorationColor: color.accentBorder,
		textUnderlineOffset: "2px",
		":hover": {
			textDecorationColor: color.accent,
		},
	},
	inlineCode: {
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.accentBorder,
		borderRadius: "0.25rem",
		backgroundColor: color.accentWash,
		color: color.accent,
		fontFamily: "var(--font-diff)",
		fontSize: font.size_2,
		paddingBlock: "0.125rem",
		paddingInline: "0.375rem",
	},
	strongBold: {
		color: color.textMain,
		fontWeight: 700,
	},
	strong: {
		color: color.textMain,
		fontWeight: 600,
	},
	italic: {
		color: color.textSoft,
		fontStyle: "italic",
	},
	deleted: {
		color: color.textMuted,
		textDecorationLine: "line-through",
	},
	heading: {
		color: color.textMain,
		fontWeight: 600,
	},
	heading1: {
		marginTop: controlSize._6,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		fontSize: "1.125rem",
		fontWeight: 700,
		paddingBottom: controlSize._2,
	},
	heading2: {
		marginTop: controlSize._5,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		fontSize: "0.9375rem",
		paddingBottom: "0.375rem",
	},
	heading3: {
		marginTop: controlSize._4,
		fontSize: "0.8125rem",
	},
	heading4: {
		marginTop: controlSize._3,
		fontSize: font.size_3,
	},
	heading5: {
		marginTop: controlSize._2,
		fontSize: "0.6875rem",
	},
	heading6: {
		marginTop: controlSize._2,
		color: color.textSoft,
		fontSize: font.size_2,
		letterSpacing: "0.04em",
		textTransform: "uppercase",
	},
	listItem: {
		color: color.textSoft,
		fontSize: "0.6875rem",
		lineHeight: 1.6,
	},
	checkSlot: {
		display: "inline-flex",
		marginRight: "0.375rem",
	},
	checkOn: {
		display: "inline-flex",
		width: "0.875rem",
		height: "0.875rem",
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.accentBorder,
		borderRadius: "0.25rem",
		backgroundColor: color.accentWash,
		color: color.accent,
		fontSize: "0.5rem",
	},
	checkOff: {
		display: "inline-flex",
		width: "0.875rem",
		height: "0.875rem",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: "0.25rem",
	},
	nestedList: {
		display: "flex",
		flexDirection: "column",
		gap: "0.125rem",
		listStyleType: "disc",
		marginTop: controlSize._1,
		paddingLeft: controlSize._5,
	},
	codeBlock: {
		position: "relative",
	},
	codeLang: {
		position: "absolute",
		top: "0.375rem",
		right: controlSize._2,
		color: "rgba(255, 255, 255, 0.4)",
		fontFamily: "var(--font-diff)",
		fontSize: "0.5rem",
		letterSpacing: "0.08em",
		textTransform: "uppercase",
	},
	pre: {
		overflowX: "auto",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.accentBorder,
		borderRadius: "0.375rem",
		backgroundColor: color.backgroundRaised,
		padding: controlSize._3,
	},
	codeText: {
		color: color.textSoft,
		fontFamily: "var(--font-diff)",
		fontSize: font.size_2,
		lineHeight: "18px",
		whiteSpace: "pre",
	},
	blockquote: {
		borderLeftWidth: 2,
		borderLeftStyle: "solid",
		borderLeftColor: color.accentBorder,
		paddingBlock: "0.125rem",
		paddingLeft: controlSize._4,
	},
	hr: {
		borderColor: color.border,
		marginBlock: controlSize._4,
	},
	tableWrap: {
		overflowX: "auto",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.accentBorder,
		borderRadius: "0.375rem",
	},
	table: {
		width: "100%",
		fontSize: font.size_2,
	},
	tableHeadRow: {
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.accentBorder,
		backgroundColor: color.accentWash,
	},
	tableHeadCell: {
		color: color.textMain,
		fontWeight: font.weight_5,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
		textAlign: "left",
		whiteSpace: "nowrap",
	},
	tableRow: {
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: "rgba(255, 255, 255, 0.04)",
	},
	tableCell: {
		color: color.textSoft,
		paddingBlock: "0.375rem",
		paddingInline: controlSize._3,
	},
	checklist: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		paddingLeft: controlSize._1,
	},
	unorderedList: {
		display: "flex",
		flexDirection: "column",
		gap: "0.125rem",
		listStyleType: "disc",
		paddingLeft: controlSize._5,
	},
	orderedList: {
		display: "flex",
		flexDirection: "column",
		gap: "0.125rem",
		listStyleType: "decimal",
		paddingLeft: controlSize._5,
	},
	paragraph: {
		color: color.textSoft,
		fontSize: "0.6875rem",
		lineHeight: 1.6,
	},
});
