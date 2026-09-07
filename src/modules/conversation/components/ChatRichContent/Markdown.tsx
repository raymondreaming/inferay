import * as stylex from "@stylexjs/stylex";
import { useNativeMarkdown } from "../../../../shared/hooks/useNativeMarkdown.tsx";
import { domStyle } from "../../../../shared/lib/dom.tsx";
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
export const Markdown = function Markdown(_props: {
	text: string;
	onMdFileClick?: (path: string) => void;
	streaming?: boolean;
}) {
	const _source = useNativeMarkdown(
		() => _props.text,
		() => (_props.streaming === undefined ? false : _props.streaming),
		() => true,
	);
	const handleTableWheel = (
		event: WheelEvent & {
			currentTarget: HTMLDivElement;
		},
	) => {
		if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey)
			return;
		const parentScroller = findParentScrollContainer(event.currentTarget);
		if (!parentScroller) return;
		parentScroller.scrollTop += event.deltaY;
		event.preventDefault();
	};
	return (
		<div {...stylex.attrs(styles.markdownRoot)}>
			{_source.loading || _source.error ? (
				<p
					{...stylex.attrs(styles.paragraph)}
					style={domStyle(inlineStyles.getMarkdownParagraphStyle())}
				>
					{_props.text}
				</p>
			) : (
				<MarkdownBlocks
					blocks={_source.blocks}
					onMdFileClick={_props.onMdFileClick}
					onTableWheel={handleTableWheel}
				/>
			)}
			{_source.error && (
				<span role="status">Formatting unavailable: {_source.error}</span>
			)}
		</div>
	);
};
