export interface ImageFileEntry {
	name: string;
	path: string;
	timestamp: number;
	size: number;
}

const addedDateFormatter = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
});

export function formatAddedDate(timestamp: number) {
	return addedDateFormatter.format(new Date(timestamp));
}

export function selectedImageFiles(
	files: ImageFileEntry[],
	selectedPaths: Set<string>,
) {
	return files.filter((file) => selectedPaths.has(file.path));
}

export function areImageFilesEqual(
	previous: ImageFileEntry[],
	next: ImageFileEntry[],
) {
	return (
		previous.length === next.length &&
		previous.every((file, index) => {
			const candidate = next[index];
			return (
				candidate !== undefined &&
				file.name === candidate.name &&
				file.path === candidate.path &&
				file.timestamp === candidate.timestamp &&
				file.size === candidate.size
			);
		})
	);
}

export function buildImageChatMessage(files: ImageFileEntry[]) {
	const displayText =
		files.length === 1
			? `Attached ${files[0]?.name ?? "file"}`
			: `Attached ${files.length} files`;
	return {
		displayText,
		fullText: `${displayText}\n\nHere are the images at these paths:\n${files.map((file) => file.path).join("\n")}`,
	};
}
