import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "octane";
import type {
	AttachedImageInfo,
	QueuedMessageInfo,
} from "../../features/chat/agent-chat-shared.ts";
import { getChatQueueReadModel } from "../../features/chat/chat-session-store.ts";
import { hasPath, lacksId } from "../../lib/data.ts";
import { wsClient } from "../../lib/websocket.ts";

interface MarkdownPreviewState {
	show: boolean;
	path: string;
	content: string | null;
	loading: boolean;
	error: string | null;
}

type FilePreviewMessage =
	| { type: "file:content"; content: string }
	| { type: "file:error"; error?: string };

function isFilePreviewMessage(msg: unknown): msg is FilePreviewMessage {
	if (!msg || typeof msg !== "object") return false;
	const type = (msg as { type?: unknown }).type;
	if (type === "file:content") {
		return typeof (msg as { content?: unknown }).content === "string";
	}
	return (
		type === "file:error" &&
		((msg as { error?: unknown }).error === undefined ||
			typeof (msg as { error?: unknown }).error === "string")
	);
}

export function useAgentChatComposerState(paneId: string, enabled = true) {
	const [attachedImages, setAttachedImages] = useState<AttachedImageInfo[]>([]);
	const attachedImagesRef = useRef(attachedImages);
	attachedImagesRef.current = attachedImages;
	const queueReadModel = useMemo(() => getChatQueueReadModel(paneId), [paneId]);
	const queuedMessages = useSyncExternalStore(
		queueReadModel.subscribe,
		queueReadModel.getSnapshot,
		queueReadModel.getSnapshot
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
		if (!enabled) return;
		void queueReadModel.loadAsync();
	}, [enabled, queueReadModel]);

	useEffect(() => {
		if (!enabled || !mdPreview.loading) return;
		const handleMessage = (msg: unknown) => {
			if (!isFilePreviewMessage(msg)) return;
			if (msg.type === "file:content") {
				setMdPreview((prev) => ({
					...prev,
					content: msg.content,
					loading: false,
				}));
			} else if (msg.type === "file:error") {
				setMdPreview((prev) => ({
					...prev,
					error: msg.error || "Failed to read file",
					loading: false,
				}));
			}
		};
		return wsClient.onMessage(handleMessage);
	}, [enabled, mdPreview.loading]);

	const replaceQueuedMessages = useCallback(
		(messages: QueuedMessageInfo[]) => {
			queueReadModel.replaceFromServer(messages);
		},
		[queueReadModel]
	);

	const removeQueuedMessage = useCallback(
		(id: string) => {
			const queue = queueReadModel.get();
			if (!queue.some((item) => item.id === id)) return;
			queueReadModel.setLocal(queue.filter(lacksId.bind(null, id)));
			if (editingQueueId === id) {
				setEditingQueueId(null);
				setEditingQueueText("");
			}
		},
		[editingQueueId, queueReadModel]
	);

	const updateQueuedMessage = useCallback(
		(id: string, text: string) => {
			const queue = queueReadModel.get();
			const existing = queue.find((item) => item.id === id);
			if (!existing || existing.text === text) return;
			queueReadModel.setLocal(
				queue.map((item) =>
					item.id === id ? { ...item, text, displayText: text } : item
				)
			);
		},
		[queueReadModel]
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
		[cancelQueuedMessageEdit, editingQueueText, updateQueuedMessage]
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
		[attachImage]
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
		[attachImage]
	);

	useEffect(
		() => () => {
			for (const img of attachedImagesRef.current) {
				URL.revokeObjectURL(img.previewUrl);
			}
		},
		[]
	);

	return {
		attachedImages,
		queuedMessages,
		replaceQueuedMessages,
		removeQueuedMessage,
		updateQueuedMessage,
		editingQueueId,
		editingQueueText,
		setEditingQueueText,
		startQueuedMessageEdit,
		cancelQueuedMessageEdit,
		saveQueuedMessageEdit,
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
