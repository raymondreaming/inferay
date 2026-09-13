import type { HunkDiff } from "@contracts";
import type { DiffViewMode } from "@repository/model/diff.ts";
import { project as rustProject } from "@shared/lib/native.tsx";

/** Adapt a renderer-owned diff projection into the UI contract. */
export function buildDiffViewerModel(
	diff: HunkDiff,
	filePath: string,
	viewMode: DiffViewMode,
): {
	changeRanges: Array<[number, number]>;
	changePositions: number[];
	extension: string;
	conflict: boolean;
	message: string | null;
	isMarkdown: boolean;
	markdownContent: string;
	navigable: boolean;
} {
	const metadata = diff.metadata;
	const line = (value: HunkDiff["newLines"][number] | undefined) =>
		value
			? {
					type: value.type,
					content: value.content,
				}
			: undefined;
	return rustProject("diffViewer", {
		filePath,
		viewMode,
		diff: {
			isBinary: diff.isBinary,
			hasConflict: !!diff.mergeConflictContent,
			oldLineCount: diff.oldLines.length,
			newLineCount: diff.newLines.length,
			compactLineCount: diff.compactLines?.length,
			firstCompactLine:
				diff.compactLines?.length === 1
					? line(diff.compactLines[0])
					: undefined,
			firstNewLine:
				diff.oldLines.length === 0 && diff.newLines.length === 1
					? line(diff.newLines[0])
					: undefined,
			newLines:
				/\.mdx?$/.test(filePath) && !diff.compactLines
					? diff.newLines.map(line)
					: undefined,
			metadata: {
				maxOldLineChars: metadata.maxOldLineChars,
				maxNewLineChars: metadata.maxNewLineChars,
				maxInlineLineChars: metadata.maxInlineLineChars,
				maxConflictLineChars: metadata.maxConflictLineChars,
				splitChangeRanges:
					viewMode === "split" ? metadata.splitChangeRanges : undefined,
				inlineChangeRanges:
					viewMode === "hunks" ? metadata.inlineChangeRanges : undefined,
			},
		},
	});
}
