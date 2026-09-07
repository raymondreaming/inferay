import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconArrowDown } from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";

export function ScrollToLatestButton({
	scrollToBottom,
}: {
	scrollToBottom: () => void;
}) {
	return (
		<button
			type="button"
			onPointerDown={(event) => {
				if (event.button === 0 && event.isPrimary) scrollToBottom();
			}}
			onClick={(event) => {
				if (event.detail === 0) scrollToBottom();
			}}
			{...stylex.props(styles.scrollButton)}
		>
			<IconArrowDown size={iconSize.md} {...stylex.props(styles.scrollIcon)} />
		</button>
	);
}
