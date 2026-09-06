import { useCallback, useEffect, useRef, useState } from "octane";
import { fetchJson, sendJson } from "../../../adapters/backend/http.ts";
import { useQueryResource } from "../../../shared/hooks/useQueryResource.tsx";
import { hasPath } from "../../../shared/lib/data.ts";
import type {
	AttachedImageInfo,
	QueuedMessageInfo,
} from "../model/agent-chat-shared.ts";

export function useAgentChatComposerState(paneId: string, enabled = true) {
	const [attachedImages, setAttachedImages] = useState<AttachedImageInfo[]>([]);
	const attachedImagesRef = useRef(attachedImages);
	attachedImagesRef.current = attachedImages;
	const [queuedMessages, setQueuedMessages] = useState<QueuedMessageInfo[]>([]);
	const queueRef = useRef(queuedMessages);
	queueRef.current = queuedMessages;
	const queueRevision = useRef(0);
	const mutationChain = useRef(Promise.resolve());
	const replaceQueue = useCallback((queue: QueuedMessageInfo[]) => {
		queueRevision.current++;
		queueRef.current = queue;
		setQueuedMessages(queue);
	}, []);
	const mutateQueue = useCallback(
		(action: "edit" | "remove", id: string, text?: string) => {
			let requestRevision = 0;
			const result = mutationChain.current
				.catch(() => undefined)
				.then(async () => {
					requestRevision = ++queueRevision.current;
					const response = await sendJson(
						`/api/chat-queues/${encodeURIComponent(paneId)}`,
						{ action, id, text },
						{ method: "PATCH" },
					);
					if (!response.ok)
						throw new Error("Could not update queued message. Please retry.");
					const queue = (
						(await response.json()) as { queue: QueuedMessageInfo[] }
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
		},
		[paneId, replaceQueue],
	);
	const [queueError, setQueueError] = useState<string | null>(null);
	const [editingQueueId, setEditingQueueId] = useState<string | null>(null);
	const [editingQueueText, setEditingQueueText] = useState("");
	const [previewPath, setPreviewPath] = useState<string | null>(null);
	const preview = useQueryResource(
		(signal) =>
			fetchJson<{ content: string }>(
				`/api/files/preview?${new URLSearchParams({ path: previewPath ?? "" })}`,
				{ signal },
			),
		null,
		{
			queryKey: ["markdown-preview", previewPath],
			enabled: enabled && previewPath !== null,
			gcTime: 0,
		},
	);
	const handleMdFileClick = useCallback(
		(path: string) => {
			if (path === previewPath) void preview.refresh();
			else setPreviewPath(path);
		},
		[previewPath, preview.refresh],
	);
	const closeMdPreview = useCallback(() => setPreviewPath(null), []);
	const mdPreview = {
		show: previewPath !== null,
		path: previewPath ?? "",
		content: preview.data?.content ?? null,
		loading: preview.loading,
		error: preview.error,
	};

	const replaceQueuedMessages = useCallback(
		(messages: QueuedMessageInfo[]) => {
			if (messages.length === 0) {
				setQueueError(null);
				setEditingQueueId(null);
				setEditingQueueText("");
			}
			const persistedIds = new Set(messages.map((message) => message.id));
			const pending = queueRef.current.filter(
				(message) => message.transient && !persistedIds.has(message.id),
			);
			replaceQueue([...messages, ...pending]);
		},
		[replaceQueue],
	);

	const stageSteeringMessage = useCallback(
		(message: QueuedMessageInfo) => {
			replaceQueue([
				...queueRef.current.filter((item) => item.id !== message.id),
				{ ...message, transient: true },
			]);
		},
		[replaceQueue],
	);

	const resolveSteeringMessage = useCallback(
		(id: string) => {
			replaceQueue(queueRef.current.filter((message) => message.id !== id));
		},
		[replaceQueue],
	);

	const removeQueuedMessage = useCallback(
		(id: string) => {
			const queue = queueRef.current;
			const existing = queue.find((item) => item.id === id);
			if (!existing || existing.transient) return;
			setQueueError(null);
			void mutateQueue("remove", id).catch((error: Error) =>
				setQueueError(error.message),
			);
			if (editingQueueId === id) {
				setEditingQueueId(null);
				setEditingQueueText("");
			}
		},
		[editingQueueId, mutateQueue],
	);

	const updateQueuedMessage = useCallback(
		(id: string, text: string) => {
			const queue = queueRef.current;
			const existing = queue.find((item) => item.id === id);
			if (!existing || existing.transient || existing.text === text) return;
			setQueueError(null);
			void mutateQueue("edit", id, text).catch((error: Error) =>
				setQueueError(error.message),
			);
		},
		[mutateQueue],
	);

	const startQueuedMessageEdit = useCallback((id: string, text: string) => {
		setEditingQueueId(id);
		setEditingQueueText(text);
	}, []);

	const cancelQueuedMessageEdit = useCallback(() => {
		setEditingQueueId(null);
		setEditingQueueText("");
	}, []);

	const saveQueuedMessageEdit = useCallback(
		(id: string) => {
			const trimmed = editingQueueText.trim();
			if (trimmed) updateQueuedMessage(id, trimmed);
			cancelQueuedMessageEdit();
		},
		[cancelQueuedMessageEdit, editingQueueText, updateQueuedMessage],
	);

	const attachImage = useCallback(async (file: File) => {
		try {
			const fd = new FormData();
			fd.append("file", file);
			const res = await fetch("/api/upload-temp", {
				method: "POST",
				body: fd,
			});
			const data = await res.json();
			if (data.path) {
				const previewUrl = URL.createObjectURL(file);
				setAttachedImages((prev) => [
					...prev,
					{ name: file.name, path: data.path, previewUrl },
				]);
			}
		} catch {}
	}, []);

	const removeAttachedImage = useCallback((path: string) => {
		setAttachedImages((prev) => {
			const target = prev.find(hasPath.bind(null, path));
			if (!target) return prev;
			URL.revokeObjectURL(target.previewUrl);
			return prev.filter((item) => item.path !== path);
		});
	}, []);

	const clearAttachedImages = useCallback(() => {
		setAttachedImages((prev) => {
			if (prev.length === 0) return prev;
			for (const img of prev) URL.revokeObjectURL(img.previewUrl);
			return [];
		});
	}, []);

	const handleDrop = useCallback(
		async (e: DragEvent) => {
			e.preventDefault();
			if (!e.dataTransfer) return;
			for (const file of Array.from(e.dataTransfer.files)) {
				if (file.type.startsWith("image/")) await attachImage(file);
			}
		},
		[attachImage],
	);

	const handlePaste = useCallback(
		async (e: ClipboardEvent) => {
			if (!e.clipboardData) return;
			for (const item of Array.from(e.clipboardData.items)) {
				if (item.type.startsWith("image/")) {
					e.preventDefault();
					const file = item.getAsFile();
					if (file) await attachImage(file);
					return;
				}
			}
		},
		[attachImage],
	);

	useEffect(
		() => () => {
			for (const img of attachedImagesRef.current) {
				URL.revokeObjectURL(img.previewUrl);
			}
		},
		[],
	);

	return {
		attachedImages,
		queuedMessages,
		queueError,
		replaceQueuedMessages,
		stageSteeringMessage,
		resolveSteeringMessage,
		removeQueuedMessage,
		updateQueuedMessage,
		editingQueueId,
		editingQueueText,
		setEditingQueueText,
		startQueuedMessageEdit,
		cancelQueuedMessageEdit,
		saveQueuedMessageEdit,
		mdPreview,
		closeMdPreview,
		handleMdFileClick,
		attachImage,
		removeAttachedImage,
		clearAttachedImages,
		handleDrop,
		handlePaste,
	};
}
