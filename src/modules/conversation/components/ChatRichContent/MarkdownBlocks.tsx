import * as stylex from "@stylexjs/stylex";
import { createMemo, For, Match, Switch } from "solid-js";
import type { MdBlock } from "../../../../../build/presentation/contracts/MdBlock.ts";
import { domStyle } from "../../../../shared/lib/dom.tsx";
import { CopyablePre } from "./CopyablePre.tsx";
import { Inline } from "./Inline.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

type MarkdownEvents = {
	onMdFileClick?: (path: string) => void;
	onTableWheel: (event: WheelEvent & { currentTarget: HTMLDivElement }) => void;
};

export function MarkdownBlocks(props: MarkdownEvents & { blocks: MdBlock[] }) {
	return (
		<For each={props.blocks} keyed={false}>
			{(block) => (
				<MarkdownBlock
					block={block()}
					onMdFileClick={props.onMdFileClick}
					onTableWheel={props.onTableWheel}
				/>
			)}
		</For>
	);
}

function MarkdownBlock(props: MarkdownEvents & { block: MdBlock }) {
	const kind = createMemo(() => props.block.type);
	const tableRows = createMemo(() => props.block.rows ?? []);
	return (
		<Switch
			fallback={
				<p {...stylex.attrs(styles.paragraph)}>
					<Inline
						tokens={props.block.tokens ?? []}
						onMdFileClick={props.onMdFileClick}
					/>
				</p>
			}
		>
			<Match when={kind() === "code" || kind() === "mermaid"}>
				<CopyablePre text={props.block.content} preStyle={styles.codeBlock} />
			</Match>
			<Match when={kind() === "heading"}>
				<p {...stylex.attrs(styles.heading)}>
					<Inline
						tokens={props.block.tokens ?? []}
						onMdFileClick={props.onMdFileClick}
					/>
				</p>
			</Match>
			<Match when={kind() === "hr"}>
				<hr />
			</Match>
			<Match when={kind() === "blockquote"}>
				<blockquote>
					<MarkdownBlocks
						blocks={props.block.children ?? []}
						onMdFileClick={props.onMdFileClick}
						onTableWheel={props.onTableWheel}
					/>
				</blockquote>
			</Match>
			<Match
				when={kind() === "ul" || kind() === "ol" || kind() === "checklist"}
			>
				<div>
					<For each={props.block.items ?? []} keyed={false}>
						{(item, index) => (
							<div
								{...stylex.attrs(styles.listItem)}
								style={domStyle(
									inlineStyles.getMarkdownBlocksListItemStyle(
										item().indent * 4,
									),
								)}
							>
								<span {...stylex.attrs(styles.listBullet)}>
									{item().checked !== undefined
										? item().checked
											? "✓"
											: "□"
										: kind() === "ol"
											? (item().bullet ?? `${index + 1}.`)
											: (item().bullet ?? "-")}
								</span>
								<span {...stylex.attrs(styles.listContent)}>
									<Inline
										tokens={item().tokens}
										onMdFileClick={props.onMdFileClick}
									/>
								</span>
							</div>
						)}
					</For>
				</div>
			</Match>
			<Match when={kind() === "table"}>
				<div {...stylex.attrs(styles.tableWrap)} onWheel={props.onTableWheel}>
					<table {...stylex.attrs(styles.table)}>
						<thead>
							<tr>
								<For each={tableRows()[0] ?? []} keyed={false}>
									{(cell) => (
										<th {...stylex.attrs(styles.tableHeadCell)}>
											<Inline
												tokens={cell()}
												onMdFileClick={props.onMdFileClick}
											/>
										</th>
									)}
								</For>
							</tr>
						</thead>
						<tbody>
							<For each={tableRows().slice(1)} keyed={false}>
								{(row, index) => (
									<tr>
										<For each={row()} keyed={false}>
											{(cell) => (
												<td
													{...stylex.attrs(styles.tableCell)}
													style={domStyle(
														inlineStyles.getMarkdownBlocksTableCellStyle(
															index < tableRows().length - 2
																? "1px solid var(--color-inferay-gray-border)"
																: "none",
														),
													)}
												>
													<Inline
														tokens={cell()}
														onMdFileClick={props.onMdFileClick}
													/>
												</td>
											)}
										</For>
									</tr>
								)}
							</For>
						</tbody>
					</table>
				</div>
			</Match>
		</Switch>
	);
}
