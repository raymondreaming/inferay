import * as stylex from "@stylexjs/stylex";
import type { MdListItem } from "../../../../../../build/presentation/contracts/MdListItem.ts";
import { InlineTokens } from "./InlineTokens.tsx";
import { styles } from "./styles.ts";
export function ListItemRenderer(_props: { item: MdListItem }) {
	return (
		<li {...stylex.attrs(styles.listItem)}>
			{_props.item.checked !== undefined && (
				<span {...stylex.attrs(styles.checkSlot)}>
					{_props.item.checked ? (
						<span {...stylex.attrs(styles.checkOn)}>✓</span>
					) : (
						<span {...stylex.attrs(styles.checkOff)} />
					)}
				</span>
			)}
			<InlineTokens tokens={_props.item.tokens} />
		</li>
	);
}
