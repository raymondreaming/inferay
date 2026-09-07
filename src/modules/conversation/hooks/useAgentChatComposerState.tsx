import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	onSettled,
} from "solid-js";
import type { QueuedMessageInfo } from "../../../../build/presentation/contracts/QueuedMessageInfo.ts";
import { useQueryResource } from "../../../shared/hooks/useQueryResource.tsx";
import {
	fetchJson,
	project as rustProject,
	sendJson,
	wsClient,
} from "../../../shared/lib/native.tsx";
export function useAgentChatComposerState(
	_paneId: Accessor<string>,
	_enabled: Accessor<boolean> = () => true,
) {
	const [attachedImages, setAttachedImages] = createSignal<AttachedImageInfo[]>(
		[],
	);
	const attachedImagesRef = {
		current: attachedImages(),
	};
	createEffect(
		() => [attachedImages()],
		() => {
			attachedImagesRef.current = attachedImages();
		},
	);
	const [queuedMessages, setQueuedMessages] = createSignal<QueuedChatMessage[]>(
		[],
	);
	const queueRef = {
		current: queuedMessages(),
	};
	createEffect(
		() => [queuedMessages()],
		() => {
			queueRef.current = queuedMessages();
		},
	);
	const queueRevision = {
		current: 0,
	};
	const mutationChain = {
		current: Promise.resolve(),
	};
	const replaceQueue = (queue: QueuedChatMessage[]) => {
		queueRevision.current++;
		queueRef.current = queue;
		setQueuedMessages(queue);
	};
	const mutateQueue = (
		action: "edit" | "remove",
		id: string,
		text?: string,
	) => {
		let requestRevision = 0;
		const result = mutationChain.current
			.catch(() => undefined)
			.then(async () => {
				requestRevision = ++queueRevision.current;
				const response = await sendJson(
					`/api/chat-queues/${encodeURIComponent(_paneId())}`,
					{
						action,
						id,
						text,
					},
					{
						method: "PATCH",
					},
				);
				if (!response.ok)
					throw new Error("Could not update queued message. Please retry.");
				const queue = (
					(await response.json()) as {
						queue: QueuedChatMessage[];
					}
				).queue;
				if (queueRevision.current === requestRevision)
					replaceQueue([
						...queue,
						...queueRef.current.filter((item) => item.transient),
					]);
			})
			.catch((error) => {
				if (queueRevision.current === requestRevision) throw error;
			});
		mutationChain.current = result;
		return result;
	};
	const [queueError, setQueueError] = createSignal<string | null>(null);
	const [editingQueueId, setEditingQueueId] = createSignal<string | null>(null);
	const [editingQueueText, setEditingQueueText] = createSignal("");
	const [previewPath, setPreviewPath] = createSignal<string | null>(null);
	const preview = useQueryResource(
		() => (signal) =>
			fetchJson<{
				content: string;
			}>(
				`/api/files/preview?${new URLSearchParams({
					path: previewPath() ?? "",
				})}`,
				{
					signal,
				},
			),
		() => null,
		() => {
			const _previewPathValue = previewPath();
			return {
				queryKey: ["markdown-preview", _previewPathValue],
				enabled: _enabled() && _previewPathValue !== null,
				gcTime: 0,
			};
		},
	);
	const handleMdFileClick = (path: string) => {
		if (path === previewPath()) void preview.refresh();
		else setPreviewPath(path);
	};
	const closeMdPreview = () => setPreviewPath(null);
	const mdPreview = createMemo(() => {
		const _previewPathValue2 = previewPath();
		return {
			show: _previewPathValue2 !== null,
			path: _previewPathValue2 ?? "",
			content: preview.data?.content ?? null,
			loading: preview.loading,
			error: preview.error,
		};
	});
	const replaceQueuedMessages = (messages: QueuedChatMessage[]) => {
		if (messages.length === 0) {
			setQueueError(null);
			setEditingQueueId(null);
			setEditingQueueText("");
		}
		replaceQueue(
			rustProject("mergeQueue", {
				current: queueRef.current,
				persisted: messages,
			}),
		);
	};
	const stageSteeringMessage = (message: QueuedChatMessage) => {
		replaceQueue([
			...queueRef.current.filter((item) => item.id !== message.id),
			{
				...message,
				transient: true,
			},
		]);
	};
	const resolveSteeringMessage = (id: string) => {
		replaceQueue(queueRef.current.filter((message) => message.id !== id));
	};
	const removeQueuedMessage = (id: string) => {
		const queue = queueRef.current;
		const existing = queue.find((message) => message.id === id);
		if (!existing || existing.transient) return;
		setQueueError(null);
		void mutateQueue("remove", id).catch((error: Error) =>
			setQueueError(error.message),
		);
		if (editingQueueId() === id) {
			setEditingQueueId(null);
			setEditingQueueText("");
		}
	};
	const updateQueuedMessage = (id: string, text: string) => {
		const queue = queueRef.current;
		const existing = queue.find((message) => message.id === id);
		if (!existing || existing.text === text) return;
		if (existing.transient) return;
		setQueueError(null);
		void mutateQueue("edit", id, text).catch((error: Error) =>
			setQueueError(error.message),
		);
	};
	const startQueuedMessageEdit = (id: string, text: string) => {
		setEditingQueueId(id);
		setEditingQueueText(text);
	};
	const cancelQueuedMessageEdit = () => {
		setEditingQueueId(null);
		setEditingQueueText("");
	};
	const saveQueuedMessageEdit = (id: string) => {
		const trimmed = editingQueueText().trim();
		if (trimmed) updateQueuedMessage(id, trimmed);
		cancelQueuedMessageEdit();
	};
	const attachImage = async (file: File) => {
		try {
			const image = await uploadChatImage(file);
			if (image) setAttachedImages((previous) => [...previous, image]);
		} catch {}
	};
	const removeAttachedImage = (path: string) => {
		setAttachedImages((prev) => {
			const target = prev.find((image) => image.path === path);
			if (!target) return prev;
			releaseChatImages([target]);
			return prev.filter((item) => item.path !== path);
		});
	};
	const clearAttachedImages = () => {
		setAttachedImages((prev) => {
			if (prev.length === 0) return prev;
			releaseChatImages(prev);
			return [];
		});
	};
	const handleDrop = async (e: DragEvent) => {
		e.preventDefault();
		if (!e.dataTransfer) return;
		for (const file of Array.from(e.dataTransfer.files)) {
			if (file.type.startsWith("image/")) await attachImage(file);
		}
	};
	const handlePaste = async (e: ClipboardEvent) => {
		if (!e.clipboardData) return;
		for (const item of Array.from(e.clipboardData.items)) {
			if (item.type.startsWith("image/")) {
				e.preventDefault();
				const file = item.getAsFile();
				if (file) await attachImage(file);
				return;
			}
		}
	};
	onSettled(() => () => {
		releaseChatImages(attachedImagesRef.current);
	});
	return {
		get attachedImages() {
			return attachedImages();
		},
		get queuedMessages() {
			return queuedMessages();
		},
		get queueError() {
			return queueError();
		},
		get replaceQueuedMessages() {
			return replaceQueuedMessages;
		},
		get stageSteeringMessage() {
			return stageSteeringMessage;
		},
		get resolveSteeringMessage() {
			return resolveSteeringMessage;
		},
		get removeQueuedMessage() {
			return removeQueuedMessage;
		},
		get updateQueuedMessage() {
			return updateQueuedMessage;
		},
		get editingQueueId() {
			return editingQueueId();
		},
		get editingQueueText() {
			return editingQueueText();
		},
		get setEditingQueueText() {
			return setEditingQueueText;
		},
		get startQueuedMessageEdit() {
			return startQueuedMessageEdit;
		},
		get cancelQueuedMessageEdit() {
			return cancelQueuedMessageEdit;
		},
		get saveQueuedMessageEdit() {
			return saveQueuedMessageEdit;
		},
		get mdPreview() {
			return mdPreview();
		},
		get closeMdPreview() {
			return closeMdPreview;
		},
		get handleMdFileClick() {
			return handleMdFileClick;
		},
		get attachImage() {
			return attachImage;
		},
		get removeAttachedImage() {
			return removeAttachedImage;
		},
		get clearAttachedImages() {
			return clearAttachedImages;
		},
		get handleDrop() {
			return handleDrop;
		},
		get handlePaste() {
			return handlePaste;
		},
	};
}
export async function uploadChatImage(
	file: File,
): Promise<AttachedImageInfo | null> {
	const body = new FormData();
	body.append("file", file);
	const response = await fetch("/api/upload-temp", {
		method: "POST",
		body,
	});
	const data = (await response.json()) as {
		path?: string;
	};
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
export function usePendingChatWorkspace(
	_paneId2: Accessor<string>,
	_cwd: Accessor<string | undefined>,
	_nativePaths: Accessor<string[] | undefined>,
) {
	const [pendingWorkspacePaths, setPendingWorkspacePaths] = createSignal(
		() => _nativePaths() ?? [],
	);
	const visibleCwd = createMemo(() => _cwd() ?? pendingWorkspacePaths()[0]);
	const savePendingWorkspaceSelection = (paths: string[]) => {
		const nextPaths = paths.filter(Boolean);
		setPendingWorkspacePaths(nextPaths);
		wsClient.send({
			type: "chat:workspace",
			paneId: _paneId2(),
			paths: nextPaths,
		});
	};
	return {
		get savePendingWorkspaceSelection() {
			return savePendingWorkspaceSelection;
		},
		get visibleCwd() {
			return visibleCwd();
		},
	};
}
export type QueuedChatMessage = QueuedMessageInfo & {
	transient?: boolean;
};
export interface AttachedImageInfo {
	name: string;
	path: string;
	previewUrl: string;
}
