export interface DiffRequest {
	cwd: string;
	revision?: string;
	file: string;
	staged: boolean;
	commitHash?: string;
	commitParent?: string;
	comparisonFrom?: string;
	comparisonTo?: string;
	view?: "full" | "review";
}

/** A presentation choice shared by the diff controller and its renderer. */
export type DiffViewMode = "split" | "hunks";
export type DiffScrollSource = "left" | "right" | "all";
