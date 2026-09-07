import * as stylex from "@stylexjs/stylex";
import { createMemo, For, Match, Show, Switch } from "solid-js";
import type { MdBlock } from "../../../../../../build/presentation/contracts/MdBlock.ts";
import { InlineTokens } from "./InlineTokens.tsx";
import { ListItemRenderer } from "./ListItemRenderer.tsx";
import { MermaidBlock } from "./MermaidBlock.tsx";
import { styles } from "./styles.ts";

export function BlockRenderer(props: { block: MdBlock }) {
	const kind = createMemo(() => props.block.type);
	const Items = () => (
		<For each={props.block.items ?? []} keyed={false}>
			{(item) => <ListItemRenderer item={item()} />}
		</For>
	);
	return (
		<Switch>
			<Match when={kind() === "heading"}>
				<div
					{...stylex.attrs(
						styles.heading,
						props.block.level === 1 && styles.heading1,
						props.block.level === 2 && styles.heading2,
						props.block.level === 3 && styles.heading3,
						props.block.level === 4 && styles.heading4,
						props.block.level === 5 && styles.heading5,
						props.block.level === 6 && styles.heading6,
					)}
				>
					<InlineTokens tokens={props.block.tokens ?? []} />
				</div>
			</Match>
			<Match when={kind() === "mermaid"}>
				<MermaidBlock code={props.block.content} />
			</Match>
			<Match when={kind() === "code"}>
				<div {...stylex.attrs(styles.codeBlock)}>
					<Show when={props.block.lang}>
						<span {...stylex.attrs(styles.codeLang)}>{props.block.lang}</span>
					</Show>
					<pre {...stylex.attrs(styles.pre)}>
						<code {...stylex.attrs(styles.codeText)}>
							{props.block.content}
						</code>
					</pre>
				</div>
			</Match>
			<Match when={kind() === "blockquote"}>
				<div {...stylex.attrs(styles.blockquote)}>
					<For each={props.block.children ?? []} keyed={false}>
						{(block) => <BlockRenderer block={block()} />}
					</For>
				</div>
			</Match>
			<Match when={kind() === "hr"}>
				<hr {...stylex.attrs(styles.hr)} />
			</Match>
			<Match when={kind() === "table"}>
				<Show when={props.block.rows?.length}>
					<div {...stylex.attrs(styles.tableWrap)}>
						<table {...stylex.attrs(styles.table)}>
							<thead>
								<tr {...stylex.attrs(styles.tableHeadRow)}>
									<For each={props.block.rows?.[0] ?? []} keyed={false}>
										{(cell) => (
											<th {...stylex.attrs(styles.tableHeadCell)}>
												<InlineTokens tokens={cell()} />
											</th>
										)}
									</For>
								</tr>
							</thead>
							<tbody>
								<For each={props.block.rows?.slice(1) ?? []} keyed={false}>
									{(row) => (
										<tr {...stylex.attrs(styles.tableRow)}>
											<For each={row()} keyed={false}>
												{(cell) => (
													<td {...stylex.attrs(styles.tableCell)}>
														<InlineTokens tokens={cell()} />
													</td>
												)}
											</For>
										</tr>
									)}
								</For>
							</tbody>
						</table>
					</div>
				</Show>
			</Match>
			<Match
				when={kind() === "ul" || kind() === "ol" || kind() === "checklist"}
			>
				<Show
					when={kind() === "ol"}
					fallback={
						<ul
							{...stylex.attrs(
								kind() === "checklist"
									? styles.checklist
									: styles.unorderedList,
							)}
						>
							<Items />
						</ul>
					}
				>
					<ol {...stylex.attrs(styles.orderedList)}>
						<Items />
					</ol>
				</Show>
			</Match>
			<Match when={kind() === "paragraph"}>
				<p {...stylex.attrs(styles.paragraph)}>
					<InlineTokens tokens={props.block.tokens ?? []} />
				</p>
			</Match>
		</Switch>
	);
}
