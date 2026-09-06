import * as stylex from "@octanejs/stylex";
import type { MdListItem } from "../../../../../shared/lib/data.ts";
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
		</li>
	);
}
