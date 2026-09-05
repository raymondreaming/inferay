import * as stylex from "@octanejs/stylex";
import { memo, useEffect, useMemo, useRef, useState } from "octane";
import {
	shouldDisableSnippetHighlighting,
	useShikiHighlighter,
	useSyntaxHighlightTheme,
} from "../../../../../shared/hooks/useShikiHighlighter.tsx";
import { indexedValues } from "../../../../../shared/lib/data.ts";
import type { FileContentResponse } from "../../../model/workbench-model.ts";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

const SOURCE_LINE_HEIGHT = 14;

const SOURCE_OVERSCAN_LINES = 30;

const MAX_SOURCE_LINE_CHARS = 12_000;

function visibleLineContent(line: string) {
	if (line.length <= MAX_SOURCE_LINE_CHARS) return line || " ";
	return `${line.slice(0, MAX_SOURCE_LINE_CHARS)} … [line truncated]`;
}

export const SourcePreview = memo(function SourcePreview({
	file,
}: {
	file: FileContentResponse;
}) {
	const [syntaxTheme] = useSyntaxHighlightTheme();
	const lines = useMemo(() => file.content.split("\n"), [file.content]);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const [viewport, setViewport] = useState({ scrollTop: 0, height: 800 });
	const start = Math.max(
		0,
		Math.floor(viewport.scrollTop / SOURCE_LINE_HEIGHT) - SOURCE_OVERSCAN_LINES,
	);
	const end = Math.min(
		lines.length,
		Math.ceil((viewport.scrollTop + viewport.height) / SOURCE_LINE_HEIGHT) +
			SOURCE_OVERSCAN_LINES,
	);
	const syntaxEnabled = useMemo(
		() => !shouldDisableSnippetHighlighting(lines),
		[lines],
	);
	const { getHighlightedLineTokens, isReady, language } = useShikiHighlighter({
		filePath: file.path,
		lines,
		visibleRange: [start, Math.max(start, end - 1)],
		theme: syntaxTheme,
		enabled: syntaxEnabled,
	});
	const visibleLines = useMemo(
		() => lines.slice(start, end),
		[lines, start, end],
	);
	const minContentChars = useMemo(() => {
		let longest = 0;
		for (const line of lines) {
			longest = Math.max(longest, Math.min(line.length, MAX_SOURCE_LINE_CHARS));
			if (longest === MAX_SOURCE_LINE_CHARS) break;
		}
		return Math.max(80, longest + 8);
	}, [lines]);

	useEffect(() => {
		const scroller = scrollRef.current;
		if (!scroller) return;
		scroller.scrollTop = 0;
		setViewport({ scrollTop: 0, height: scroller.clientHeight || 800 });
		const observer = new ResizeObserver((entries) => {
			const height = entries[0]?.contentRect.height;
			if (!height) return;
			setViewport((current) =>
				current.height === height ? current : { ...current, height },
			);
		});
		observer.observe(scroller);
		return () => observer.disconnect();
	}, [file.path]);

	return (
		<div
			ref={scrollRef}
			onScroll={(event) =>
				setViewport((current) => ({
					...current,
					scrollTop: event.currentTarget.scrollTop,
				}))
			}
			{...stylex.props(styles.sourceScroll)}
		>
			<div
				{...stylex.props(styles.sourceCanvas)}
				style={inlineStyles.getSourcePreviewSourceCanvasStyle(
					lines.length * SOURCE_LINE_HEIGHT + 16,
					`max(100%, ${minContentChars}ch)`,
				)}
			>
				<div
					{...stylex.props(styles.sourceTable)}
					style={inlineStyles.getSourcePreviewSourceTableStyle(
						`translate3d(0, ${start * SOURCE_LINE_HEIGHT + 8}px, 0)`,
					)}
				>
					{indexedValues(visibleLines).map(({ index, value }) => {
						const absoluteIndex = start + index;
						const tokens =
							isReady && language && value.length <= MAX_SOURCE_LINE_CHARS
								? getHighlightedLineTokens(absoluteIndex)
								: undefined;
						return (
							<div key={absoluteIndex} {...stylex.props(styles.sourceLine)}>
								<span {...stylex.props(styles.lineNumber)}>
									{absoluteIndex + 1}
								</span>
								<span {...stylex.props(styles.sourceCode)}>
									{tokens?.length
										? tokens.map((token, tokenIndex) => (
												<span
													key={tokenIndex}
													style={inlineStyles.getSourcePreviewSpanStyle(
														token.color,
														token.bgColor,
													)}
												>
													{token.content}
												</span>
											))
										: visibleLineContent(value)}
								</span>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
});
