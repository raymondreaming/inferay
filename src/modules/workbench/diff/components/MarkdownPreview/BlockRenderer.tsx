import * as stylex from "@octanejs/stylex";
import { indexedValues } from "../../../../../shared/lib/indexed-values.ts";
import type {
	MdBlock,
	MdListItem,
} from "../../../../../shared/lib/markdown.ts";
import { InlineTokens } from "./InlineTokens.tsx";
import { ListItemRenderer } from "./ListItemRenderer.tsx";
import { MermaidBlock } from "./MermaidBlock.tsx";
import { styles } from "./styles.ts";

function renderListItem(item: MdListItem, key: number) {
	return <ListItemRenderer key={key} item={item} />;
}

export function BlockRenderer({ block }: { block: MdBlock }) {
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
						block.level === 6 && styles.heading6,
					)}
				>
					<InlineTokens tokens={block.tokens ?? []} />
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
			const innerBlocks = block.children ?? [];
			return (
				<div {...stylex.props(styles.blockquote)}>
					{indexedValues(innerBlocks).map(({ index, value: inner }) => (
						<BlockRenderer key={index} block={inner} />
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
								{indexedValues(block.rows[0] ?? []).map(
									({ index, value: cell }) => (
										<th key={index} {...stylex.props(styles.tableHeadCell)}>
											<InlineTokens tokens={cell} />
										</th>
									),
								)}
							</tr>
						</thead>
						<tbody>
							{indexedValues(block.rows.slice(1)).map(
								({ index: rowIndex, value: row }) => (
									<tr key={rowIndex} {...stylex.props(styles.tableRow)}>
										{indexedValues(row).map(({ index, value: cell }) => (
											<td key={index} {...stylex.props(styles.tableCell)}>
												<InlineTokens tokens={cell} />
											</td>
										))}
									</tr>
								),
							)}
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
					<InlineTokens tokens={block.tokens ?? []} />
				</p>
			);
	}
}
