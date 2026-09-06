import * as stylex from "@octanejs/stylex";
import type { MdBlock, MdListItem } from "../../../../../shared/lib/data.ts";
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
					{innerBlocks.map((inner, index) => (
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
								{(block.rows[0] ?? []).map((cell, index) => (
									<th key={index} {...stylex.props(styles.tableHeadCell)}>
										<InlineTokens tokens={cell} />
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{block.rows.slice(1).map((row, rowIndex) => (
								<tr key={rowIndex} {...stylex.props(styles.tableRow)}>
									{row.map((cell, index) => (
										<td key={index} {...stylex.props(styles.tableCell)}>
											<InlineTokens tokens={cell} />
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);

		case "checklist":
		case "ul":
		case "ol": {
			const List = block.type === "ol" ? "ol" : "ul";
			return (
				<List
					{...stylex.props(
						block.type === "checklist"
							? styles.checklist
							: block.type === "ol"
								? styles.orderedList
								: styles.unorderedList,
					)}
				>
					{(block.items ?? []).map(renderListItem)}
				</List>
			);
		}

		case "paragraph":
			return (
				<p {...stylex.props(styles.paragraph)}>
					<InlineTokens tokens={block.tokens ?? []} />
				</p>
			);
	}
}
