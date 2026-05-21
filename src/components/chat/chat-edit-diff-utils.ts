export type DiffLine = {
	type: "context" | "removed" | "added";
	text: string;
	oldLineNum?: number;
	newLineNum?: number;
};

export type DiffHunk = {
	lines: DiffLine[];
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
	hiddenBefore: number;
	hiddenAfter: number;
};

export type DiffSummary = {
	hunks: DiffHunk[];
	stats: { added: number; removed: number };
	allLines: string[];
	totalHidden: number;
};

export type LineTextSegment = {
	text: string;
	changed: boolean;
};

function tokenizeInlineText(text: string): string[] {
	return text.match(/\s+|[A-Za-z0-9_$]+|./g) ?? [];
}

function mergeInlineSegments(
	tokens: string[],
	changedTokens: Set<number>
): LineTextSegment[] {
	const segments: LineTextSegment[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const changed = changedTokens.has(i);
		const previous = segments[segments.length - 1];
		if (previous && previous.changed === changed) {
			previous.text += tokens[i];
		} else {
			segments.push({ text: tokens[i]!, changed });
		}
	}
	return segments.length > 0 ? segments : [{ text: "", changed: false }];
}

export function diffLineTextSegments(
	oldText: string,
	newText: string
): { oldSegments: LineTextSegment[]; newSegments: LineTextSegment[] } {
	const oldTokens = tokenizeInlineText(oldText);
	const newTokens = tokenizeInlineText(newText);
	const lcs: number[][] = [];

	for (let i = 0; i <= oldTokens.length; i++) {
		lcs[i] = [];
		const row = lcs[i]!;
		for (let j = 0; j <= newTokens.length; j++) {
			if (i === 0 || j === 0) {
				row[j] = 0;
			} else if (oldTokens[i - 1] === newTokens[j - 1]) {
				row[j] = lcs[i - 1]![j - 1]! + 1;
			} else {
				row[j] = Math.max(lcs[i - 1]![j]!, row[j - 1]!);
			}
		}
	}

	const unchangedOld = new Set<number>();
	const unchangedNew = new Set<number>();
	let i = oldTokens.length;
	let j = newTokens.length;
	while (i > 0 && j > 0) {
		if (oldTokens[i - 1] === newTokens[j - 1]) {
			unchangedOld.add(i - 1);
			unchangedNew.add(j - 1);
			i--;
			j--;
		} else if (lcs[i]![j - 1]! >= lcs[i - 1]![j]!) {
			j--;
		} else {
			i--;
		}
	}

	const changedOld = new Set<number>();
	const changedNew = new Set<number>();
	for (let idx = 0; idx < oldTokens.length; idx++) {
		if (!unchangedOld.has(idx)) changedOld.add(idx);
	}
	for (let idx = 0; idx < newTokens.length; idx++) {
		if (!unchangedNew.has(idx)) changedNew.add(idx);
	}

	return {
		oldSegments: mergeInlineSegments(oldTokens, changedOld),
		newSegments: mergeInlineSegments(newTokens, changedNew),
	};
}

export function summarizeHunks(hunks: DiffLine[][]) {
	let added = 0;
	let removed = 0;
	const allLines: string[] = [];
	for (const hunk of hunks) {
		for (const line of hunk) {
			if (line.type === "added") added++;
			else if (line.type === "removed") removed++;
			allLines.push(line.text);
		}
	}
	return { hunks, stats: { added, removed }, allLines };
}

export function summarizeDiff(
	oldStr: string,
	newStr: string,
	contextLines = 2
): DiffSummary {
	const hunks = computeDiffHunkDetails(oldStr, newStr, contextLines);
	let added = 0;
	let removed = 0;
	let totalHidden = 0;
	const allLines: string[] = [];

	for (const hunk of hunks) {
		totalHidden += hunk.hiddenBefore + hunk.hiddenAfter;
		for (const line of hunk.lines) {
			if (line.type === "added") added++;
			else if (line.type === "removed") removed++;
			allLines.push(line.text);
		}
	}

	return { hunks, stats: { added, removed }, allLines, totalHidden };
}

function groupChangedRuns(lines: DiffLine[]): DiffLine[] {
	const result: DiffLine[] = [];
	let changedRun: DiffLine[] = [];
	const flushChangedRun = () => {
		if (changedRun.length === 0) return;
		result.push(...changedRun.filter((line) => line.type === "removed"));
		result.push(...changedRun.filter((line) => line.type === "added"));
		changedRun = [];
	};

	for (const line of lines) {
		if (line.type === "removed" || line.type === "added") {
			changedRun.push(line);
			continue;
		}
		flushChangedRun();
		result.push(line);
	}

	flushChangedRun();
	return result;
}

function getRangeStartAndCount(values: number[]): {
	start: number;
	count: number;
} {
	if (values.length === 0) return { start: 0, count: 0 };
	const start = Math.min(...values);
	const end = Math.max(...values);
	return { start, count: end - start + 1 };
}

function getHunkRange(lines: DiffLine[]) {
	const oldLineNumbers = lines
		.map((line) => line.oldLineNum)
		.filter((value): value is number => typeof value === "number");
	const newLineNumbers = lines
		.map((line) => line.newLineNum)
		.filter((value): value is number => typeof value === "number");
	const oldRange = getRangeStartAndCount(oldLineNumbers);
	const newRange = getRangeStartAndCount(newLineNumbers);
	return {
		oldStart:
			oldRange.count > 0
				? oldRange.start
				: Math.max(0, (newLineNumbers[0] ?? 1) - 1),
		oldCount: oldRange.count,
		newStart:
			newRange.count > 0
				? newRange.start
				: Math.max(0, (oldLineNumbers[0] ?? 1) - 1),
		newCount: newRange.count,
	};
}

function computeDiffLines(oldStr: string, newStr: string) {
	const oldLines = oldStr.split("\n");
	const newLines = newStr.split("\n");
	const lcs: number[][] = [];

	for (let i = 0; i <= oldLines.length; i++) {
		lcs[i] = [];
		const row = lcs[i]!;
		for (let j = 0; j <= newLines.length; j++) {
			if (i === 0 || j === 0) {
				row[j] = 0;
			} else if (oldLines[i - 1] === newLines[j - 1]) {
				row[j] = lcs[i - 1]![j - 1]! + 1;
			} else {
				row[j] = Math.max(lcs[i - 1]![j]!, row[j - 1]!);
			}
		}
	}

	const ops: {
		type: "equal" | "delete" | "insert";
		oldIdx?: number;
		newIdx?: number;
	}[] = [];
	let i = oldLines.length;
	let j = newLines.length;

	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
			ops.unshift({ type: "equal", oldIdx: i - 1, newIdx: j - 1 });
			i--;
			j--;
		} else if (j > 0 && (i === 0 || lcs[i]![j - 1]! >= lcs[i - 1]![j]!)) {
			ops.unshift({ type: "insert", newIdx: j - 1 });
			j--;
		} else {
			ops.unshift({ type: "delete", oldIdx: i - 1 });
			i--;
		}
	}

	const diffLines: (DiffLine & { opIdx: number })[] = [];
	for (let idx = 0; idx < ops.length; idx++) {
		const op = ops[idx]!;
		if (op.type === "equal") {
			diffLines.push({
				type: "context",
				text: oldLines[op.oldIdx!]!,
				oldLineNum: op.oldIdx! + 1,
				newLineNum: op.newIdx! + 1,
				opIdx: idx,
			});
		} else if (op.type === "delete") {
			diffLines.push({
				type: "removed",
				text: oldLines[op.oldIdx!]!,
				oldLineNum: op.oldIdx! + 1,
				opIdx: idx,
			});
		} else {
			diffLines.push({
				type: "added",
				text: newLines[op.newIdx!]!,
				newLineNum: op.newIdx! + 1,
				opIdx: idx,
			});
		}
	}

	return diffLines;
}

export function computeDiffHunkDetails(
	oldStr: string,
	newStr: string,
	contextLines = 2
): DiffHunk[] {
	const diffLines = computeDiffLines(oldStr, newStr);
	const changedRows: number[] = [];

	for (let idx = 0; idx < diffLines.length; idx++) {
		if (diffLines[idx]?.type !== "context") changedRows.push(idx);
	}

	if (changedRows.length === 0) return [];

	const ranges: Array<{ start: number; end: number }> = [];
	for (const row of changedRows) {
		const start = Math.max(0, row - contextLines);
		const end = Math.min(diffLines.length - 1, row + contextLines);
		const previous = ranges[ranges.length - 1];
		if (previous && start <= previous.end + contextLines + 1) {
			previous.end = Math.max(previous.end, end);
		} else {
			ranges.push({ start, end });
		}
	}

	return ranges.map((range, index) => {
		const previousEnd = index === 0 ? -1 : ranges[index - 1]!.end;
		const lines = groupChangedRuns(
			diffLines.slice(range.start, range.end + 1).map((line) => ({
				type: line.type,
				text: line.text,
				oldLineNum: line.oldLineNum,
				newLineNum: line.newLineNum,
			}))
		);
		return {
			lines,
			...getHunkRange(lines),
			hiddenBefore: Math.max(0, range.start - previousEnd - 1),
			hiddenAfter:
				index === ranges.length - 1
					? Math.max(0, diffLines.length - range.end - 1)
					: 0,
		};
	});
}

export function computeDiffHunks(
	oldStr: string,
	newStr: string,
	contextLines = 2
): DiffLine[][] {
	return computeDiffHunkDetails(oldStr, newStr, contextLines).map(
		(hunk) => hunk.lines
	);
}

export function applyEditsSequentially(
	edits: { old_string: string; new_string: string }[]
): { originalText: string; finalText: string } | null {
	if (edits.length === 0) return null;

	let currentText = edits[0]!.old_string;
	const originalText = currentText;

	for (const edit of edits) {
		const idx = currentText.indexOf(edit.old_string);
		if (idx !== -1) {
			currentText =
				currentText.slice(0, idx) +
				edit.new_string +
				currentText.slice(idx + edit.old_string.length);
		} else {
			currentText = edit.new_string;
		}
	}

	return { originalText, finalText: currentText };
}
