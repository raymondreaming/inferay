import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	loadFileBackedQueue,
	loadStoredQueue,
	saveStoredQueue,
} from "../../features/chat/chat-session-store.ts";
import { CLIENT_STORAGE_CHANGED_EVENT } from "../../lib/client-storage-sync.ts";
import { CHAT_QUEUE_KEY_PREFIX } from "../../lib/client-storage-keys.ts";
import { lacksId, lacksPath } from "../../lib/data.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";
import { wsClient } from "../../lib/websocket.ts";

interface QueuedMessage {
	id: string;
	text: string;
	displayText: string;
	images?: string[];
}

interface AttachedImageState {
	name: string;
	path: string;
	previewUrl: string;
	thumbnailPath?: string;
}

interface MarkdownPreviewState {
	show: boolean;
	path: string;
	content: string | null;
	loading: boolean;
	error: string | null;
}

let queueIdCounter = 0;

function nextQueueId(): string {
	return typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: `${Date.now()}-${++queueIdCounter}`;
}

function queuedMessagesScore(queue: QueuedMessage[]): number {
	return queue.reduce(
		(score, item) => score + 1 + item.text.length + item.displayText.length,
		0
	);
}

export function useAgentChatComposerState(paneId: string) {
	const [isDragOver, setIsDragOver] = useState(false);
	const [attachedImages, setAttachedImages] = useState<AttachedImageState[]>(
		[]
	);
	const queueRef = useRef<QueuedMessage[]>(
		loadStoredQueue<QueuedMessage>(paneId)
	);
	const [queuedMessages, setQueuedMessagesState] = useState<QueuedMessage[]>(
		() => queueRef.current
	);
	const [editingQueueId, setEditingQueueId] = useState<string | null>(null);
	const [editingQueueText, setEditingQueueText] = useState("");
	const [mdPreview, setMdPreview] = useState<MarkdownPreviewState>({
		show: false,
		path: "",
		content: null,
		loading: false,
		error: null,
	});

	const handleMdFileClick = useCallback((filePath: string) => {
		setMdPreview({
			show: true,
			path: filePath,
			content: null,
			loading: true,
			error: null,
		});
		wsClient.send({ type: "file:read", path: filePath });
	}, []);

	useEffect(() => {
		let active = true;
		const next = loadStoredQueue<QueuedMessage>(paneId);
		queueRef.current = next;
		setQueuedMessagesState(next);
		void loadFileBackedQueue<QueuedMessage>(paneId).then((fileBackedQueue) => {
			if (!active) return;
			if (
				queuedMessagesScore(fileBackedQueue) <=
				queuedMessagesScore(queueRef.current)
			) {
				return;
			}
			queueRef.current = fileBackedQueue;
			setQueuedMessagesState(fileBackedQueue);
			saveStoredQueue(paneId, fileBackedQueue);
		});
		return () => {
			active = false;
		};
	}, [paneId]);

	useEffect(() => {
		const handleMessage = (msg: Record<string, unknown>) => {
			if (msg.type === "file:content" && mdPreview.loading) {
				setMdPreview((prev) => ({
					...prev,
					content: msg.content as string,
					loading: false,
				}));
			} else if (msg.type === "file:error" && mdPreview.loading) {
				setMdPreview((prev) => ({
					...prev,
					error: (msg.error as string) || "Failed to read file",
					loading: false,
				}));
			}
		};
		return wsClient.onMessage(handleMessage);
	}, [mdPreview.loading]);

	const setQueuedMessages = useCallback(
		(messages: QueuedMessage[]) => {
			queueRef.current = messages;
			setQueuedMessagesState(messages);
			saveStoredQueue(paneId, messages);
		},
		[paneId]
	);

	useEffect(
		() =>
			listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
				const detail = (
					event as CustomEvent<{ key?: string; value?: string | null }>
				).detail;
				if (detail?.key !== `${CHAT_QUEUE_KEY_PREFIX}${paneId}`) return;
				const next = loadStoredQueue<QueuedMessage>(paneId);
				queueRef.current = next;
				setQueuedMessagesState(next);
			}),
		[paneId]
	);

	const queueMessage = useCallback(
		(text: string, displayText: string, images?: string[]) => {
			setQueuedMessages([
				...queueRef.current,
				{
					id: nextQueueId(),
					text,
					displayText,
					images: images?.length ? images : undefined,
				},
			]);
		},
		[setQueuedMessages]
	);

	const shiftQueuedMessage = useCallback(() => {
		const [next = null, ...rest] = queueRef.current;
		setQueuedMessages(rest);
		return next;
	}, [setQueuedMessages]);

	const removeQueuedMessage = useCallback(
		(id: string) => {
			setQueuedMessages(queueRef.current.filter(lacksId.bind(null, id)));
		},
		[setQueuedMessages]
	);

	const updateQueuedMessage = useCallback(
		(id: string, text: string) => {
			setQueuedMessages(
				queueRef.current.map((item) =>
					item.id === id ? { ...item, text, displayText: text } : item
				)
			);
		},
		[setQueuedMessages]
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
				const previewPath =
					typeof data.thumbnailPath === "string"
						? data.thumbnailPath
						: data.path;
				const previewUrl = `/api/file?path=${encodeURIComponent(previewPath)}`;
				setAttachedImages((prev) => [
					...prev,
					{
						name: file.name,
						path: data.path,
						previewUrl,
						thumbnailPath:
							typeof data.thumbnailPath === "string"
								? data.thumbnailPath
								: undefined,
					},
				]);
			}
		} catch {}
	}, []);

	const removeAttachedImage = useCallback((path: string) => {
		setAttachedImages((prev) => {
			return prev.filter(lacksPath.bind(null, path));
		});
	}, []);

	const clearAttachedImages = useCallback(() => {
		setAttachedImages([]);
	}, []);

	const handleDrop = useCallback(
		async (e: React.DragEvent) => {
			e.preventDefault();
			setIsDragOver(false);
			for (const file of Array.from(e.dataTransfer.files)) {
				if (file.type.startsWith("image/")) await attachImage(file);
			}
		},
		[attachImage]
	);

	const handlePaste = useCallback(
		async (e: React.ClipboardEvent) => {
			for (const item of Array.from(e.clipboardData.items)) {
				if (item.type.startsWith("image/")) {
					e.preventDefault();
					const file = item.getAsFile();
					if (file) await attachImage(file);
					return;
				}
			}
		},
		[attachImage]
	);

	return {
		isDragOver,
		setIsDragOver,
		attachedImages,
		queueRef,
		queuedMessages,
		setQueuedMessages,
		queueMessage,
		shiftQueuedMessage,
		removeQueuedMessage,
		updateQueuedMessage,
		editingQueueId,
		setEditingQueueId,
		editingQueueText,
		setEditingQueueText,
		mdPreview,
		setMdPreview,
		handleMdFileClick,
		attachImage,
		removeAttachedImage,
		clearAttachedImages,
		handleDrop,
		handlePaste,
	};
}
