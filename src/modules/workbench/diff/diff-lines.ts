import type { DiffLine } from "../../../modules/repository/useGitDiff.tsx";
import { contentOf } from "../../../shared/lib/data.ts";

const INLINE_CONTEXT_LINES = 4;

export type MinimapSegment = {
	type: "add" | "remove";
	side: "left" | "right" | "full";
	startLine: number;
	endLine: number;
};

export function alignDiffLines(lines: DiffLine[], length: number): DiffLine[] {
	return Array.from(
		{ length },
		(_, index) =>
			lines[index] ?? {
				number: null,
				content: "",
				type: "spacer",
			},
	);
}

export function buildMarkdownContent(lines: DiffLine[]): string {
	return lines
		.filter((line) => line.type !== "hunk" && line.type !== "spacer")
		.map(contentOf)
		.join("\n");
}

export function buildStackedLines(
	oldLines: DiffLine[],
	newLines: DiffLine[],
	onlyChanges: boolean,
): DiffLine[] {
	const result: DiffLine[] = [];
	const max = Math.max(oldLines.length, newLines.length);
	for (let index = 0; index < max; index++) {
		const oldLine = oldLines[index];
		const newLine = newLines[index];
		if (oldLine?.type === "hunk" || newLine?.type === "hunk") {
			result.push({ number: null, content: "", type: "hunk" });
			continue;
		}
		if (oldLine?.type === "context" && newLine?.type === "context") {
			if (!onlyChanges) result.push(newLine);
			continue;
		}
		if (oldLine && oldLine.type !== "spacer") {
			if (!onlyChanges || oldLine.type !== "context") result.push(oldLine);
		}
		if (newLine && newLine.type !== "spacer") {
			if (!onlyChanges || newLine.type !== "context") result.push(newLine);
		}
	}
	return result;
}

export function buildInlineHunkLines(
	oldLines: DiffLine[],
	newLines: DiffLine[],
): DiffLine[] {
	const stacked = buildStackedLines(oldLines, newLines, false);
	const changedRows = stacked.flatMap((line, index) =>
		line.type === "add" || line.type === "remove" ? [index] : [],
	);
	if (changedRows.length === 0) return stacked;

	const ranges: Array<{ start: number; end: number }> = [];
	for (const row of changedRows) {
		const start = Math.max(0, row - INLINE_CONTEXT_LINES);
		const end = Math.min(stacked.length - 1, row + INLINE_CONTEXT_LINES);
		const previous = ranges[ranges.length - 1];
		if (previous && start <= previous.end + INLINE_CONTEXT_LINES + 1) {
			previous.end = Math.max(previous.end, end);
		} else {
			ranges.push({ start, end });
		}
	}

	const result: DiffLine[] = [];
	for (let index = 0; index < ranges.length; index++) {
		const range = ranges[index]!;
		const previousEnd = index === 0 ? -1 : ranges[index - 1]!.end;
		appendHiddenContext(result, range.start - previousEnd - 1);
		appendInlineRows(result, stacked.slice(range.start, range.end + 1));
	}
	const finalRange = ranges[ranges.length - 1];
	if (finalRange)
		appendHiddenContext(result, stacked.length - finalRange.end - 1);
	return result;
}

export function buildMinimapSegments(
	lines: DiffLine[],
	side: MinimapSegment["side"],
): MinimapSegment[] {
	const segments: MinimapSegment[] = [];
	let currentType = "";
	let startLine = 0;
	for (let index = 0; index < lines.length && segments.length < 100; index++) {
		const lineType = lines[index]?.type;
		const type = lineType === "add" || lineType === "remove" ? lineType : "";
		if (type === currentType) continue;
		if (currentType) {
			segments.push({
				type: currentType as MinimapSegment["type"],
				side,
				startLine,
				endLine: index,
			});
		}
		currentType = type;
		startLine = index;
	}
	if (currentType && segments.length < 100) {
		segments.push({
			type: currentType as MinimapSegment["type"],
			side,
			startLine,
			endLine: lines.length,
		});
	}
	return segments;
}

function appendHiddenContext(result: DiffLine[], hiddenCount: number) {
	if (hiddenCount <= 0) return;
	result.push({
		number: null,
		content: `... ${hiddenCount.toLocaleString()} unchanged ${
			hiddenCount === 1 ? "line" : "lines"
		} hidden ...`,
		type: "hunk",
	});
}

function appendInlineRows(result: DiffLine[], rows: DiffLine[]) {
	let changedRun: DiffLine[] = [];
	const flush = () => {
		result.push(...changedRun.filter((line) => line.type === "remove"));
		result.push(...changedRun.filter((line) => line.type === "add"));
		changedRun = [];
	};
	for (const row of rows) {
		if (row.type === "add" || row.type === "remove") changedRun.push(row);
		else {
			flush();
			result.push(row);
		}
	}
	flush();
}
