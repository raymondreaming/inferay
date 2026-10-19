import type { MemoryGraphNode } from "@contracts";

export type MemoryItem = Pick<
	MemoryGraphNode,
	"id" | "kind" | "title" | "source" | "size"
>;
export type MemoryCategory = "all" | "text" | "images" | "files" | "chats";
export const MEMORY_CATEGORIES: { id: MemoryCategory; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "text", label: "Text" },
	{ id: "images", label: "Images" },
	{ id: "files", label: "Files" },
	{ id: "chats", label: "Chats" },
];
export const memoryCategory = (
	item: MemoryItem,
): Exclude<MemoryCategory, "all"> =>
	item.kind === "source"
		? "chats"
		: item.kind === "note"
			? "text"
			: item.kind === "image"
				? "images"
				: "files";
export const memoryIconPath = (item: MemoryItem) => {
	if (item.kind === "source")
		return item.source.startsWith("run:")
			? "M8 5v14l11-7z"
			: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z";
	if (item.kind === "note") return "M14 3H6v18h12V7z M14 3v4h4 M9 12h6 M9 16h6";
	const ext = item.title.split(".").pop()?.toLowerCase() ?? "";
	if (["mp4", "mov", "webm"].includes(ext))
		return "M3 5h18v14H3z M10 9l5 3-5 3z";
	if (["mp3", "wav", "m4a"].includes(ext))
		return "M9 18V6l11-2v12 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z";
	if (ext === "pdf") return "M14 3H6v18h12V7z M14 3v4h4 M8.5 15h7 M8.5 18h4";
	return "M14 3H6v18h12V7z M14 3v4h4";
};
export const memoryKindLabel = (item: MemoryItem) =>
	item.kind === "source"
		? item.source.startsWith("run:")
			? "Run"
			: "Chat"
		: item.kind === "note"
			? "Note"
			: item.kind === "image"
				? "Image"
				: "File";
export const memoryOriginLabel = (item: MemoryItem) =>
	item.source.startsWith("chat:")
		? "A chat in this project"
		: item.source.startsWith("run:")
			? "An automation run"
			: item.source === "dropped"
				? "Dropped in"
				: item.source === "agent"
					? "Saved by an agent"
					: "Written here";
export const formatBytes = (size: number) =>
	size >= 1_000_000
		? `${(size / 1_000_000).toFixed(1)} MB`
		: `${Math.max(1, Math.round(size / 1000))} KB`;
export const clampZoom = (k: number) => Math.min(4, Math.max(0.2, k));
export const continuationDraft = (
	chat: string,
	notes: string[],
	files: string[],
) =>
	[
		`Continue from the chat “${chat}”. These memories were saved from it:`,
		...notes,
		files.length ? `Files saved from it: ${files.join(", ")}` : "",
		"Use them as context, and search project memory for anything related before answering.",
	]
		.filter(Boolean)
		.join("\n\n");
