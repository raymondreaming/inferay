import type { FileContent } from "@contracts";
import { useSyntaxHighlight } from "@shared/hooks/useSyntaxHighlight.tsx";
import { px } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, For } from "solid-js";
import { styles } from "./styles.ts";

const SOURCE_LINE_HEIGHT = 14;
const SOURCE_OVERSCAN_LINES = 30;
const MAX_SOURCE_LINE_CHARS = 12_000;
function visibleLineContent(line: string) {
	if (line.length <= MAX_SOURCE_LINE_CHARS) return line || " ";
	return `${line.slice(0, MAX_SOURCE_LINE_CHARS)} … [line truncated]`;
}
export const SourcePreview = function SourcePreview(_props: {
	file: FileContent;
}) {
	const lines = createMemo(() => _props.file.content.split("\n"));
	const scrollRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const [viewport, setViewport] = createSignal({
		scrollTop: 0,
		height: 800,
	});
	const start = createMemo(() =>
		Math.max(
			0,
			Math.floor(viewport().scrollTop / SOURCE_LINE_HEIGHT) -
				SOURCE_OVERSCAN_LINES,
		),
	);
	const end = createMemo(() => {
		const _viewportValue = viewport();
		return Math.min(
			lines().length,
			Math.ceil(
				(_viewportValue.scrollTop + _viewportValue.height) / SOURCE_LINE_HEIGHT,
			) + SOURCE_OVERSCAN_LINES,
		);
	});
	const _source = useSyntaxHighlight(() => ({
		filePath: _props.file.path,
		lines: lines(),
	}));
	const visibleLines = createMemo(() =>
		Array.from(
			{ length: Math.max(0, end() - start()) },
			(_, offset) => start() + offset,
		),
	);
	const minContentChars = createMemo(() => {
		let longest = 0;
		for (const line of lines()) {
			longest = Math.max(longest, Math.min(line.length, MAX_SOURCE_LINE_CHARS));
			if (longest === MAX_SOURCE_LINE_CHARS) break;
		}
		return Math.max(80, longest + 8);
	});
	createEffect(
		() => [_props.file.path],
		() => {
			const scroller = scrollRef.current;
			if (!scroller) return;
			scroller.scrollTop = 0;
			setViewport({
				scrollTop: 0,
				height: scroller.clientHeight || 800,
			});
			const observer = new ResizeObserver((entries) => {
				const height = entries[0]?.contentRect.height;
				if (!height) return;
				setViewport((current) =>
					current.height === height
						? current
						: {
								...current,
								height,
							},
				);
			});
			observer.observe(scroller);
			return () => observer.disconnect();
		},
	);
	return (
		<div
			ref={(element) => (scrollRef.current = element)}
			onScroll={(event) =>
				setViewport((current) => ({
					...current,
					scrollTop: event.currentTarget.scrollTop,
				}))
			}
			{...stylex.attrs(styles.sourceScroll)}
		>
			<div
				{...stylex.attrs(styles.sourceCanvas)}
				style={{
					height: px(lines().length * SOURCE_LINE_HEIGHT + 16),
					"min-width": `max(100%, ${minContentChars()}ch)`,
				}}
			>
				<div
					{...stylex.attrs(styles.sourceTable)}
					style={{
						transform: `translate3d(0, ${start() * SOURCE_LINE_HEIGHT + 8}px, 0)`,
					}}
				>
					{
						<For each={visibleLines()} keyed={(index) => index}>
							{(absoluteIndex) => {
								const tokens = createMemo(() =>
									_source.isReady &&
									_source.language &&
									lines()[absoluteIndex()]!.length <= MAX_SOURCE_LINE_CHARS
										? _source.getLineTokens(absoluteIndex())
										: undefined,
								);
								return (
									<div {...stylex.attrs(styles.sourceLine)}>
										<span {...stylex.attrs(styles.lineNumber)}>
											{absoluteIndex() + 1}
										</span>
										<span {...stylex.attrs(styles.sourceCode)}>
											{tokens()?.length ? (
												<For each={tokens()!} keyed={false}>
													{(token) => (
														<span class={`syntax-${token().kind}`}>
															{token().text}
														</span>
													)}
												</For>
											) : (
												visibleLineContent(lines()[absoluteIndex()]!)
											)}
										</span>
									</div>
								);
							}}
						</For>
					}
				</div>
			</div>
		</div>
	);
};
