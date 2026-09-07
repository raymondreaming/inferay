import * as stylex from "@stylexjs/stylex";
import { CopyButton } from "./CopyButton.tsx";
import { styles } from "./styles.ts";
export function CopyablePre(_props: { text: string; preStyle: unknown }) {
	return (
		<div {...stylex.attrs(styles.codeWrap)}>
			<pre {...stylex.attrs(_props.preStyle as never)}>{_props.text}</pre>
			<div {...stylex.attrs(styles.copyOverlay)}>
				<CopyButton text={_props.text} />
			</div>
		</div>
	);
}
