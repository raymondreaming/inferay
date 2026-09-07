import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import { useNativeMarkdown } from "../../../../../shared/hooks/useNativeMarkdown.tsx";
import { BlockRenderer } from "./BlockRenderer.tsx";
import { styles } from "./styles.ts";
export const MarkdownPreview = function MarkdownPreview(_props: {
	content: string;
}) {
	const _source = useNativeMarkdown(() => _props.content);
	return (
		<div {...stylex.attrs(styles.root)}>
			{_source.loading || _source.error ? (
				<>
					{_source.error && (
						<p role="status" {...stylex.attrs(styles.errorPre)}>
							Markdown preview unavailable.
						</p>
					)}
					<pre {...stylex.attrs(styles.plainText)}>{_props.content}</pre>
				</>
			) : (
				<For each={_source.blocks} keyed={false}>
					{(block, index) => <BlockRenderer block={block()} />}
				</For>
			)}
		</div>
	);
};
