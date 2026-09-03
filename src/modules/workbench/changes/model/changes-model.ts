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

export interface FileTreeNode<T> {
	name: string;
	path: string;
	children: Map<string, FileTreeNode<T>>;
	file?: T;
}

export function sortFileTreeChildren<T>(node: FileTreeNode<T>) {
	return Array.from(node.children.values()).toSorted((a, b) =>
		a.name.localeCompare(b.name),
	);
}

export function buildFileTree<T extends { path: string }>(files: readonly T[]) {
	const root: FileTreeNode<T> = { name: "", path: "", children: new Map() };
	for (const file of files) {
		const parts = file.path.split("/");
		let current = root;
		let currentPath = "";
		for (let index = 0; index < parts.length; index++) {
			const part = parts[index]!;
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			if (!current.children.has(part)) {
				current.children.set(part, {
					name: part,
					path: currentPath,
					children: new Map(),
				});
			}
			current = current.children.get(part)!;
			if (index === parts.length - 1) current.file = file;
		}
	}
	return root;
}

export function getAlphabeticalFileOrder<T extends { path: string }>(
	files: readonly T[],
) {
	return files.toSorted((a, b) => a.path.localeCompare(b.path));
}

export function getTreeFileOrder<T extends { path: string }>(
	files: readonly T[],
) {
	const ordered: T[] = [];
	const visit = (node: FileTreeNode<T>) => {
		for (const child of sortFileTreeChildren(node)) {
			if (child.file) ordered.push(child.file);
			else visit(child);
		}
	};
	visit(buildFileTree(files));
	return ordered;
}

export function getExpandedFileDirectories<T extends { path: string }>(
	files: readonly T[],
) {
	const directories = new Set<string>();
	for (const file of files) {
		const parts = file.path.split("/");
		let path = "";
		for (let index = 0; index < parts.length - 1; index++) {
			path = path ? `${path}/${parts[index]}` : parts[index]!;
			directories.add(path);
		}
	}
	return directories;
}
