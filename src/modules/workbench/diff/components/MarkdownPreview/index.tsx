import * as stylex from "@octanejs/stylex";
import { memo } from "octane";
import { useNativeMarkdown } from "../../../../../shared/hooks/useNativeMarkdown.tsx";
import { BlockRenderer } from "./BlockRenderer.tsx";
import { styles } from "./styles.ts";

export const MarkdownPreview = memo(function MarkdownPreview({
	content,
}: {
	content: string;
}) {
	const { blocks, loading, error } = useNativeMarkdown(content);
	return (
		<div {...stylex.props(styles.root)}>
			{loading || error ? (
				<>
					{error && (
						<p role="status" {...stylex.props(styles.errorPre)}>
							Markdown preview unavailable.
						</p>
					)}
					<pre {...stylex.props(styles.plainText)}>{content}</pre>
				</>
			) : (
				blocks.map((block, index) => (
					<BlockRenderer key={index} block={block} />
				))
			)}
		</div>
	);
});
