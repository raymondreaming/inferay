export type DiffLine = {
	type: "context" | "removed" | "added";
	text: string;
	oldLineNum?: number;
	newLineNum?: number;
};

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

export function computeDiffHunks(
	oldStr: string,
	newStr: string,
	contextLines = 2
): DiffLine[][] {
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

	const hunks: DiffLine[][] = [];
	let currentHunk: DiffLine[] = [];
	let lastChangeIdx = -999;

	for (let idx = 0; idx < diffLines.length; idx++) {
		const line = diffLines[idx]!;
		const isChange = line.type !== "context";

		if (isChange) {
			const contextStart = Math.max(
				lastChangeIdx + contextLines + 1,
				idx - contextLines
			);
			for (let c = contextStart; c < idx; c++) {
				const contextLine = diffLines[c];
				if (contextLine && contextLine.type === "context") {
					currentHunk.push({
						type: contextLine.type,
						text: contextLine.text,
						oldLineNum: contextLine.oldLineNum,
						newLineNum: contextLine.newLineNum,
					});
				}
			}
			currentHunk.push({
				type: line.type,
				text: line.text,
				oldLineNum: line.oldLineNum,
				newLineNum: line.newLineNum,
			});
			lastChangeIdx = idx;
		} else if (idx - lastChangeIdx <= contextLines && lastChangeIdx >= 0) {
			currentHunk.push({
				type: line.type,
				text: line.text,
				oldLineNum: line.oldLineNum,
				newLineNum: line.newLineNum,
			});
		} else if (currentHunk.length > 0 && idx - lastChangeIdx > contextLines) {
			hunks.push(currentHunk);
			currentHunk = [];
		}
	}

	if (currentHunk.length > 0) hunks.push(currentHunk);
	return hunks.map(groupChangedRuns);
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
