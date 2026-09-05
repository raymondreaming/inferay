import * as stylex from "@octanejs/stylex";
import type { MdListItem } from "../../../../../shared/lib/data.ts";
import { indexedValues } from "../../../../../shared/lib/data.ts";
import { InlineTokens } from "./InlineTokens.tsx";
import { styles } from "./styles.ts";

export function ListItemRenderer({ item }: { item: MdListItem }) {
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
			<InlineTokens tokens={item.tokens} />
			{item.children.length > 0 && (
				<ul {...stylex.props(styles.nestedList)}>
					{indexedValues(item.children).map(({ index, value: child }) => (
						<ListItemRenderer key={index} item={child} />
					))}
				</ul>
			)}
		</li>
	);
}
