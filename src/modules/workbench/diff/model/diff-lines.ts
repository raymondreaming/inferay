import type {
	DiffLine,
	HunkDiff,
	HunkDiffStats,
} from "../../../../modules/repository/model/types.ts";
import { contentOf } from "../../../../shared/lib/data.ts";

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

export function shouldDisableDiffTokenization(diff: HunkDiff): boolean {
	return diff.metadata?.tokenizationDisabled ?? true;
}

export function summarizeHunkDiff(diff: HunkDiff | null): HunkDiffStats {
	return diff?.metadata?.stats ?? { added: 0, removed: 0, hunks: 0, lines: 0 };
}
