export type LineTextSegment = {
	text: string;
	changed: boolean;
};

export type GitDiffLine = {
	type: "context" | "removed" | "added";
	text: string;
	oldLineNum?: number;
	newLineNum?: number;
	segments?: LineTextSegment[];
};

export type DiffHunk = {
	lines: GitDiffLine[];
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
};

export type SequentialEdit = {
	old_string: string;
	new_string: string;
};
