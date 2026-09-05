import * as stylex from "@octanejs/stylex";
import { useRef } from "octane";
import type { SyntaxHighlightTheme } from "../../../../../shared/hooks/useShikiHighlighter.tsx";
import type {
	DiffLine,
	DiffMinimapSegment as MinimapSegment,
} from "../../../../repository/model/types.ts";
import { diffStyles } from "./styles.ts";
import { VirtualPanel } from "./VirtualPanel.tsx";

export function MergeConflictPanel({
	lines,
	minimapSegments,
	maxLineChars,
	disableTokenize,
	ext,
	filePath,
	syntaxTheme,
}: {
	lines: DiffLine[];
	minimapSegments?: MinimapSegment[];
	maxLineChars?: number;
	disableTokenize: boolean;
	ext: string;
	filePath: string;
	syntaxTheme: SyntaxHighlightTheme;
}) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	return (
		<div {...stylex.props(diffStyles.conflictBody)}>
			<div {...stylex.props(diffStyles.conflictActions)}>
				<button
					type="button"
					{...stylex.props(diffStyles.conflictActionButton)}
				>
					Accept current change
				</button>
				<button
					type="button"
					{...stylex.props(diffStyles.conflictActionButton)}
				>
					Accept incoming change
				</button>
				<button
					type="button"
					{...stylex.props(diffStyles.conflictActionButton)}
				>
					Accept both
				</button>
			</div>
			<VirtualPanel
				minimapSegments={minimapSegments}
				lines={lines}
				maxLineChars={maxLineChars}
				ext={ext}
				scrollRef={scrollRef}
				disableTokenize={disableTokenize}
				showMinimap
				side="single"
				filePath={filePath}
				syntaxTheme={syntaxTheme}
			/>
		</div>
	);
}
