import { project as rustProject } from "../../../adapters/presentation/model.ts";
import type {
	AttachedImageInfo,
	QueuedChatMessage,
} from "./agent-chat-shared.ts";

export function mergeNativeQueue(
	current: QueuedChatMessage[],
	persisted: QueuedChatMessage[],
): QueuedChatMessage[] {
	return rustProject("mergeQueue", { current, persisted });
}

export async function uploadChatImage(
	file: File,
): Promise<AttachedImageInfo | null> {
	const body = new FormData();
	body.append("file", file);
	const response = await fetch("/api/upload-temp", { method: "POST", body });
	const data = (await response.json()) as { path?: string };
	return data.path
		? {
				name: file.name,
				path: data.path,
				previewUrl: URL.createObjectURL(file),
			}
		: null;
}

export function releaseChatImages(images: AttachedImageInfo[]) {
	for (const image of images) URL.revokeObjectURL(image.previewUrl);
}
