import * as stylex from "@octanejs/stylex";
import { useRef } from "octane";
import type { SyntaxHighlightTheme } from "../../../../../shared/hooks/useShikiHighlighter.tsx";
import type {
	DiffLine,
	DiffMinimapSegment as MinimapSegment,
} from "../../../../repository/model/types.ts";
import type { DiffScrollSource } from "../../hooks/useSplitDiffScroll.tsx";
import { diffStyles } from "./styles.ts";
import { VirtualPanel } from "./VirtualPanel.tsx";

export function SinglePanel({
	lines,
	minimapSegments,
	maxLineChars,
	ext,
	disableTokenize,
	externalScrollTop,
	externalScrollSource,
	filePath,
	syntaxTheme,
}: {
	lines: DiffLine[];
	minimapSegments?: MinimapSegment[];
	maxLineChars?: number;
	ext: string;
	disableTokenize: boolean;
	externalScrollTop?: number;
	externalScrollSource?: DiffScrollSource;
	filePath?: string;
	syntaxTheme: SyntaxHighlightTheme;
}) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	return (
		<div {...stylex.props(diffStyles.singlePanel)}>
			<VirtualPanel
				minimapSegments={minimapSegments}
				lines={lines}
				maxLineChars={maxLineChars}
				ext={ext}
				scrollRef={scrollRef}
				disableTokenize={disableTokenize}
				showMinimap
				externalScrollTop={externalScrollTop}
				externalScrollSource={externalScrollSource}
				side="single"
				filePath={filePath}
				syntaxTheme={syntaxTheme}
			/>
		</div>
	);
}
