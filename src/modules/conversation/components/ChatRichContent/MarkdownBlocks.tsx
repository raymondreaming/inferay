import * as stylex from "@octanejs/stylex";
import type { MdBlock } from "../../../../shared/lib/data.ts";
import { CopyablePre } from "./CopyablePre.tsx";
import { Inline } from "./Inline.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

export function MarkdownBlocks({
	blocks,
	onMdFileClick,
	onTableWheel,
}: {
	blocks: MdBlock[];
	onMdFileClick?: (path: string) => void;
	onTableWheel: (event: WheelEvent & { currentTarget: HTMLDivElement }) => void;
}) {
	return (
		<>
			{blocks.map((block, index) => {
				switch (block.type) {
					case "code":
					case "mermaid":
						return (
							<CopyablePre
								key={index}
								text={block.content}
								preStyle={styles.codeBlock}
							/>
						);
					case "heading":
						return (
							<p key={index} {...stylex.props(styles.heading)}>
								<Inline
									tokens={block.tokens ?? []}
									onMdFileClick={onMdFileClick}
								/>
							</p>
						);
					case "hr":
						return <hr key={index} />;
					case "blockquote":
						return (
							<blockquote key={index}>
								<MarkdownBlocks
									blocks={block.children ?? []}
									onMdFileClick={onMdFileClick}
									onTableWheel={onTableWheel}
								/>
							</blockquote>
						);
					case "ul":
					case "ol":
					case "checklist":
						return (
							<div key={index}>
								{(block.items ?? []).map((item, itemIndex) => (
									<div
										key={itemIndex}
										{...stylex.props(styles.listItem)}
										style={inlineStyles.getMarkdownBlocksListItemStyle(
											item.indent * 4,
										)}
									>
										<span {...stylex.props(styles.listBullet)}>
											{item.checked !== undefined
												? item.checked
													? "✓"
													: "□"
												: block.type === "ol"
													? (item.bullet ?? `${itemIndex + 1}.`)
													: (item.bullet ?? "-")}
										</span>
										<span {...stylex.props(styles.listContent)}>
											<Inline
												tokens={item.tokens}
												onMdFileClick={onMdFileClick}
											/>
										</span>
									</div>
								))}
							</div>
						);
					case "table": {
						const [headers = [], ...rows] = block.rows ?? [];
						return (
							<div
								key={index}
								{...stylex.props(styles.tableWrap)}
								onWheel={onTableWheel}
							>
								<table {...stylex.props(styles.table)}>
									<thead>
										<tr>
											{headers.map((cell, cellIndex) => (
												<th
													key={cellIndex}
													{...stylex.props(styles.tableHeadCell)}
												>
													<Inline tokens={cell} onMdFileClick={onMdFileClick} />
												</th>
											))}
										</tr>
									</thead>
									<tbody>
										{rows.map((row, rowIndex) => (
											<tr key={rowIndex}>
												{row.map((cell, cellIndex) => (
													<td
														key={cellIndex}
														{...stylex.props(styles.tableCell)}
														style={inlineStyles.getMarkdownBlocksTableCellStyle(
															rowIndex < rows.length - 1
																? "1px solid var(--color-inferay-gray-border)"
																: "none",
														)}
													>
														<Inline
															tokens={cell}
															onMdFileClick={onMdFileClick}
														/>
													</td>
												))}
											</tr>
										))}
									</tbody>
								</table>
							</div>
						);
					}
					default:
						return (
							<p key={index} {...stylex.props(styles.paragraph)}>
								<Inline
									tokens={block.tokens ?? []}
									onMdFileClick={onMdFileClick}
								/>
							</p>
						);
				}
			})}
		</>
	);
}
