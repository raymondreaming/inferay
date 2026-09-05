export interface GitFileTreeNode {
	name: string;
	path: string;
	children: GitFileTreeNode[];
	fileRange: readonly [number, number];
}

export interface GitFilePresentation {
	pathOrder: string[];
	treeOrder: string[];
	tree: GitFileTreeNode[];
}

export interface GitFileEntry {
	status: string; // M, A, D, ?, R, C, U
	staged: boolean;
	path: string;
	originalPath?: string;
	additions?: number;
	deletions?: number;
}

export interface GitProjectStatus {
	filePresentation?: GitFilePresentation;
	cwd: string;
	name: string;
	branch: string;
	upstream: string | null;
	ahead: number;
	behind: number;
	stagedCount: number;
	unstagedCount: number;
	untrackedCount: number;
	files: GitFileEntry[];
}

/** Native repository semantics; pixel geometry remains a browser concern. */
export interface GitGraphNavigation {
	historyOrder?: number;
	containingBranch?: string;
	parent?: string;
	child?: string;
	branchNewer?: string;
	branchOlder?: string;
}
export type GitGraphAncestry = Record<string, Array<[number, number]>>;

// Single line in a diff view
export interface DiffLine {
	number: number | null;
	content: string;
	type: "add" | "remove" | "context" | "spacer" | "hunk";
}

// Full diff result with aligned old/new lines
export interface HunkDiff {
	oldLines: DiffLine[];
	newLines: DiffLine[];
	compactLines?: DiffLine[];
	inlineLines?: DiffLine[];
	conflictLines?: DiffLine[];
	isBinary: boolean;
	isNew: boolean;
	isImage?: boolean;
	imagePath?: string;
	rawPatch?: string;
	mergeConflictContent?: string;
	metadata?: {
		stats: HunkDiffStats;
		tokenizationDisabled: boolean;
		maxOldLineChars: number;
		maxNewLineChars: number;
		maxInlineLineChars?: number;
		maxConflictLineChars?: number;
		splitChangeRanges?: Array<[number, number]>;
		inlineChangeRanges?: Array<[number, number]>;
		splitMinimap?: DiffMinimapSegment[];
		inlineMinimap?: DiffMinimapSegment[];
		conflictMinimap?: DiffMinimapSegment[];
	};
}

// Request parameters for loading a diff
export interface DiffRequest {
	cwd: string;
	repositoryRevision?: string;
	file: string;
	staged: boolean;
	commitHash?: string;
	commitParent?: string;
	comparisonFrom?: string;
	comparisonTo?: string;
	view?: "full" | "review";
}

export interface HunkDiffStats {
	added: number;
	removed: number;
	hunks: number;
	lines: number;
}

export type GitInteractiveRebaseStep = {
	readonly hash: string;
	readonly action: "pick" | "reword" | "squash" | "drop";
	readonly message?: string;
};

export type DiffMinimapSegment = {
	type: "add" | "remove";
	side: "left" | "right" | "full";
	startLine: number;
	endLine: number;
};
