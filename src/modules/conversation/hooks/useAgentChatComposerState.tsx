import type { QueuedMessageInfo } from "@contracts";
import {
	loadMarkdownPreview,
	type UploadedChatImage,
	updateChatQueue,
	uploadTempChatImage,
} from "@conversation/services/conversationApi.ts";
import { useQueryResource } from "@shared/hooks/useQueryResource.tsx";
import { project as rustProject, wsClient } from "@shared/lib/native.tsx";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	untrack,
} from "solid-js";
export function useAgentChatComposerState(
	_paneId: Accessor<string>,
	_enabled: Accessor<boolean> = () => true,
) {
	const [attachedImages, setAttachedImages] = createSignal<UploadedChatImage[]>(
		[],
	);
	const [queuedMessages, setQueuedMessages] = createSignal<QueuedChatMessage[]>(
		[],
	);
	let disposed = false;
	onCleanup(() => {
		disposed = true;
	});
	let queueSnapshot: QueuedChatMessage[] = [];
	let queueRevision = 0;
	let mutationChain = Promise.resolve();
	const replaceQueue = (queue: QueuedChatMessage[]) => {
		queueRevision++;
		queueSnapshot = queue;
		setQueuedMessages(queue);
	};
	const projectQueue = (operation: string, input: object) =>
		replaceQueue(rustProject(operation, { current: queueSnapshot, ...input }));
	const mutateQueue = (
		action: "edit" | "remove",
		id: string,
		text?: string,
	) => {
		const paneId = _paneId();
		let requestRevision = 0;
		const result = mutationChain
			.catch(() => undefined)
			.then(async () => {
				if (disposed || paneId !== _paneId()) return;
				requestRevision = ++queueRevision;
				const queue = await updateChatQueue(paneId, action, id, text);
				if (
					!disposed &&
					paneId === _paneId() &&
					queueRevision === requestRevision
				)
					projectQueue("mergeQueue", { persisted: queue });
			})
			.catch((error) => {
				if (
					!disposed &&
					paneId === _paneId() &&
					queueRevision === requestRevision
				)
					throw error;
			});
		mutationChain = result;
		return result;
	};
	const [queueError, setQueueError] = createSignal<string | null>(null);
	const [editingQueueId, setEditingQueueId] = createSignal<string | null>(null);
	const [editingQueueText, setEditingQueueText] = createSignal("");
	const cancelQueuedMessageEdit = () => {
		setEditingQueueId(null);
		setEditingQueueText("");
	};
	let queuePaneId = untrack(_paneId);
	createEffect(_paneId, (paneId) => {
		if (paneId === queuePaneId) return;
		queuePaneId = paneId;
		replaceQueue([]);
		setQueueError(null);
		cancelQueuedMessageEdit();
		setAttachedImages([]);
	});
	const [previewPath, setPreviewPath] = createSignal<string | null>(null);
	const preview = useQueryResource(
		() => {
			const path = previewPath() ?? "";
			return (signal) => loadMarkdownPreview(path, signal);
		},
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
			cancelQueuedMessageEdit();
		}
		projectQueue("mergeQueue", { persisted: messages });
	};
	const stageSteeringMessage = (message: QueuedChatMessage) => {
		projectQueue("stageQueueMessage", { message });
	};
	const resolveSteeringMessage = (id: string) => {
		projectQueue("resolveQueueMessage", { id });
	};
	const removeQueuedMessage = (id: string) => {
		const existing = queueSnapshot.find((message) => message.id === id);
		if (!existing || existing.transient) return;
		setQueueError(null);
		void mutateQueue("remove", id).catch((error: Error) =>
			setQueueError(error.message),
		);
		if (editingQueueId() === id) cancelQueuedMessageEdit();
	};
	const updateQueuedMessage = (id: string, text: string) => {
		const existing = queueSnapshot.find((message) => message.id === id);
		if (!existing || existing.transient || existing.text === text) return;
		setQueueError(null);
		void mutateQueue("edit", id, text).catch((error: Error) =>
			setQueueError(error.message),
		);
	};
	const startQueuedMessageEdit = (id: string, text: string) => {
		setEditingQueueId(id);
		setEditingQueueText(text);
	};
	const saveQueuedMessageEdit = (id: string) => {
		const trimmed = editingQueueText().trim();
		if (trimmed) updateQueuedMessage(id, trimmed);
		cancelQueuedMessageEdit();
	};
	const attachImage = async (file: File) => {
		const paneId = _paneId();
		try {
			const image = await uploadTempChatImage(file);
			if (image && !disposed && paneId === _paneId())
				setAttachedImages((previous) => [...previous, image]);
		} catch {}
	};
	const removeAttachedImage = (path: string) => {
		setAttachedImages((prev) => {
			const target = prev.find((image) => image.path === path);
			if (!target) return prev;
			return prev.filter((item) => item.path !== path);
		});
	};
	const clearAttachedImages = () => {
		setAttachedImages((prev) => {
			if (prev.length === 0) return prev;
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
		replaceQueuedMessages,
		stageSteeringMessage,
		resolveSteeringMessage,
		removeQueuedMessage,
		updateQueuedMessage,
		get editingQueueId() {
			return editingQueueId();
		},
		get editingQueueText() {
			return editingQueueText();
		},
		setEditingQueueText,
		startQueuedMessageEdit,
		cancelQueuedMessageEdit,
		saveQueuedMessageEdit,
		get mdPreview() {
			return mdPreview();
		},
		closeMdPreview,
		handleMdFileClick,
		attachImage,
		removeAttachedImage,
		clearAttachedImages,
		handleDrop,
		handlePaste,
	};
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
		savePendingWorkspaceSelection,
		get visibleCwd() {
			return visibleCwd();
		},
	};
}
export type QueuedChatMessage = QueuedMessageInfo & {
	transient?: boolean;
};
