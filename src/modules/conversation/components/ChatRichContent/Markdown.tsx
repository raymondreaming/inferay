import * as stylex from "@octanejs/stylex";
import { memo, useCallback } from "octane";
import { useNativeMarkdown } from "../../../../shared/hooks/useNativeMarkdown.tsx";
import { MarkdownBlocks } from "./MarkdownBlocks.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

function findParentScrollContainer(
	node: HTMLElement | null,
): HTMLElement | null {
	let current = node?.parentElement ?? null;
	while (current) {
		const style = window.getComputedStyle(current);
		const canScrollY =
			(style.overflowY === "auto" || style.overflowY === "scroll") &&
			current.scrollHeight > current.clientHeight;
		if (canScrollY) return current;
		current = current.parentElement;
	}
	return null;
}

export const Markdown = memo(function Markdown({
	text,
	onMdFileClick,
	streaming = false,
}: {
	text: string;
	onMdFileClick?: (path: string) => void;
	streaming?: boolean;
}) {
	const { blocks, loading, error } = useNativeMarkdown(text, streaming, true);
	const handleTableWheel = useCallback(
		(event: WheelEvent & { currentTarget: HTMLDivElement }) => {
			if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey)
				return;
			const parentScroller = findParentScrollContainer(event.currentTarget);
			if (!parentScroller) return;
			parentScroller.scrollTop += event.deltaY;
			event.preventDefault();
		},
		[],
	);
	return (
		<div {...stylex.props(styles.markdownRoot)}>
			{loading || error ? (
				<p
					{...stylex.props(styles.paragraph)}
					style={inlineStyles.getMarkdownParagraphStyle()}
				>
					{text}
				</p>
			) : (
				<MarkdownBlocks
					blocks={blocks}
					onMdFileClick={onMdFileClick}
					onTableWheel={handleTableWheel}
				/>
			)}
			{error && <span role="status">Formatting unavailable: {error}</span>}
		</div>
	);
});
