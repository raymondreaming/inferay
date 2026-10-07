import type { PluginImportFile } from "../../services/projectsApi.ts";

/** Capture directory handles during the drop event, before its data store closes. */
export function droppedPluginFiles(transfer: DataTransfer) {
	const entries = Array.from(transfer.items)
		.filter((item) => item.kind === "file")
		.map((item) => ({
			entry: item.webkitGetAsEntry?.(),
			file: item.getAsFile(),
		}));
	return collect(entries);
}

async function collect(
	items: { entry: FileSystemEntry | null | undefined; file: File | null }[],
) {
	const files: PluginImportFile[] = [];
	let count = 0;
	let size = 0;
	function add(path: string, file: File) {
		size += file.size;
		if (files.length >= 1000 || size > 50_000_000)
			throw new Error("Library exceeds 1,000 entries or 50 MB.");
		files.push({ path, file });
	}
	async function visit(
		entry: FileSystemEntry,
		parent: string,
		depth: number,
	): Promise<void> {
		if (++count > 1000 || depth > 13)
			throw new Error("Library has too many entries or nested folders.");
		const path = parent ? `${parent}/${entry.name}` : entry.name;
		if (entry.isFile) {
			const file = await new Promise<File>((resolve, reject) =>
				(entry as FileSystemFileEntry).file(resolve, reject),
			);
			add(path, file);
		} else if (entry.isDirectory) {
			const reader = (entry as FileSystemDirectoryEntry).createReader();
			for (;;) {
				const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
					reader.readEntries(resolve, reject),
				);
				if (!batch.length) break;
				for (const child of batch) await visit(child, path, depth + 1);
			}
		}
	}
	for (const item of items) {
		if (item.entry) await visit(item.entry, "", 0);
		else if (item.file) add(item.file.name, item.file);
	}
	const folder =
		items.length === 1 && items[0].entry?.isDirectory
			? items[0].entry.name
			: null;
	return {
		name: folder ?? "Imported library",
		files: folder
			? files.map(({ path, file }) => ({
					path: path.slice(folder.length + 1),
					file,
				}))
			: files,
	};
}
