import * as stylex from "@stylexjs/stylex";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconArrowDown } from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";
export function ScrollToLatestButton(_props: { scrollToBottom: () => void }) {
	return (
		<button
			type="button"
			onPointerDown={(event) => {
				if (event.button === 0 && event.isPrimary) _props.scrollToBottom();
			}}
			onClick={(event) => {
				if (event.detail === 0) _props.scrollToBottom();
			}}
			{...stylex.attrs(styles.scrollButton)}
		>
			<IconArrowDown size={iconSize.md} {...stylex.attrs(styles.scrollIcon)} />
		</button>
	);
}
