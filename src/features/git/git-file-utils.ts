export function isStagedChange(file: { staged: boolean }): boolean {
	return file.staged;
}

export function isUnstagedTrackedChange(file: {
	staged: boolean;
	status: string;
}): boolean {
	return !file.staged && file.status !== "?";
}

export function isUntrackedChange(file: { status: string }): boolean {
	return file.status === "?";
}

export function orderGitFiles<T extends { staged: boolean }>(
	files: readonly T[]
): T[] {
	return [
		...files.filter((file) => !file.staged),
		...files.filter(isStagedChange),
	];
}

export function orderProjectGitFiles<T extends { staged: boolean }>(
	project: { files: readonly T[] } | null | undefined
): T[] {
	return project ? orderGitFiles(project.files) : [];
}
