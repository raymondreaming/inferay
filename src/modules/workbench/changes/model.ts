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
	files: readonly T[],
): T[] {
	return [
		...files.filter((file) => !file.staged),
		...files.filter(isStagedChange),
	];
}

export function orderProjectGitFiles<T extends { staged: boolean }>(
	project: { files: readonly T[] } | null | undefined,
): T[] {
	return project ? orderGitFiles(project.files) : [];
}

export function getFileSelectionAfterToggle<
	T extends { path: string; staged: boolean },
>(files: readonly T[], selected: { path: string; staged: boolean }): T | null {
	const currentIndex = files.findIndex(
		(file) => file.path === selected.path && file.staged === selected.staged,
	);
	if (currentIndex < 0) return null;

	const current = files[currentIndex]!;
	const sectionFiles = files.filter((file) => file.staged === current.staged);
	const sectionIndex = sectionFiles.findIndex(
		(file) => file.path === current.path,
	);
	const adjacent =
		sectionFiles[sectionIndex + 1] ?? sectionFiles[sectionIndex - 1] ?? null;
	if (adjacent) return adjacent;

	return { ...current, staged: !current.staged };
}

export function resolveGitFileSelection<
	T extends { path: string; staged: boolean },
>(files: readonly T[], selected: { path: string; staged: boolean }): T | null {
	return (
		files.find(
			(file) => file.path === selected.path && file.staged === selected.staged,
		) ??
		files.find((file) => file.path === selected.path) ??
		null
	);
}
