import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "octane";
import { fetchJson } from "../../../adapters/backend/http.ts";
import type {
	AttachedImageInfo,
	QueuedMessageInfo,
} from "../../../modules/conversation/model/agent-chat-shared.ts";
import { getChatQueueReadModel } from "../../../modules/conversation/model/chat-session-store.ts";
import { hasPath } from "../../../shared/lib/data.ts";

interface MarkdownPreviewState {
	show: boolean;
	path: string;
	content: string | null;
	loading: boolean;
	error: string | null;
}

export function useAgentChatComposerState(paneId: string, enabled = true) {
	const [attachedImages, setAttachedImages] = useState<AttachedImageInfo[]>([]);
	const attachedImagesRef = useRef(attachedImages);
	attachedImagesRef.current = attachedImages;
	const queueReadModel = useMemo(() => getChatQueueReadModel(paneId), [paneId]);
	const queuedMessages = useSyncExternalStore(
		queueReadModel.subscribe,
		queueReadModel.getSnapshot,
		queueReadModel.getSnapshot,
	);
	const [queueError, setQueueError] = useState<string | null>(null);
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
	}, []);

	useEffect(() => {
		if (!enabled || !mdPreview.loading) return;
		const controller = new AbortController();
		const finish = (patch: Partial<MarkdownPreviewState>) => {
			if (!controller.signal.aborted)
				setMdPreview((previous) => ({ ...previous, ...patch, loading: false }));
		};
		void fetchJson<{ content: string }>(
			`/api/files/preview?${new URLSearchParams({ path: mdPreview.path })}`,
			{ signal: controller.signal },
		)
			.then(({ content }) => finish({ content }))
			.catch((error) =>
				finish({
					error: error instanceof Error ? error.message : "Failed to read file",
				}),
			);
		return () => controller.abort();
	}, [enabled, mdPreview.loading, mdPreview.path]);

	const replaceQueuedMessages = useCallback(
		(messages: QueuedMessageInfo[]) => {
			const persistedIds = new Set(messages.map((message) => message.id));
			const pending = queueReadModel
				.get()
				.filter(
					(message) => message.transient && !persistedIds.has(message.id),
				);
			queueReadModel.replaceFromServer([...messages, ...pending]);
		},
		[queueReadModel],
	);

	const stageSteeringMessage = useCallback(
		(message: QueuedMessageInfo) => {
			queueReadModel.replaceFromServer([
				...queueReadModel.get().filter((item) => item.id !== message.id),
				{ ...message, transient: true },
			]);
		},
		[queueReadModel],
	);

	const resolveSteeringMessage = useCallback(
		(id: string) => {
			queueReadModel.replaceFromServer(
				queueReadModel.get().filter((message) => message.id !== id),
			);
		},
		[queueReadModel],
	);

	const removeQueuedMessage = useCallback(
		(id: string) => {
			const queue = queueReadModel.get();
			const existing = queue.find((item) => item.id === id);
			if (!existing || existing.transient) return;
			setQueueError(null);
			void queueReadModel
				.mutate("remove", id)
				.catch((error: Error) => setQueueError(error.message));
			if (editingQueueId === id) {
				setEditingQueueId(null);
				setEditingQueueText("");
			}
		},
		[editingQueueId, queueReadModel],
	);

	const updateQueuedMessage = useCallback(
		(id: string, text: string) => {
			const queue = queueReadModel.get();
			const existing = queue.find((item) => item.id === id);
			if (!existing || existing.transient || existing.text === text) return;
			setQueueError(null);
			void queueReadModel
				.mutate("edit", id, text)
				.catch((error: Error) => setQueueError(error.message));
		},
		[queueReadModel],
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
		setMdPreview,
		handleMdFileClick,
		attachImage,
		removeAttachedImage,
		clearAttachedImages,
		handleDrop,
		handlePaste,
	};
}
