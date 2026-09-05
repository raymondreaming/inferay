import * as stylex from "@octanejs/stylex";
import { CopyButton } from "./CopyButton.tsx";
import { styles } from "./styles.ts";

export function CopyablePre({
	text,
	preStyle,
}: {
	text: string;
	preStyle: unknown;
}) {
	return (
		<div {...stylex.props(styles.codeWrap)}>
			<pre {...stylex.props(preStyle as never)}>{text}</pre>
			<div {...stylex.props(styles.copyOverlay)}>
				<CopyButton text={text} />
			</div>
		</div>
	);
}
