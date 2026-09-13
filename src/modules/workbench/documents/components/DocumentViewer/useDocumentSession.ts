import {
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onSettled,
	untrack,
} from "solid-js";
import type { FileContent } from "../../../../../../build/presentation/contracts/FileContent.ts";
import { fetchJson, postJson } from "../../../../../shared/lib/native.tsx";
import type { DocumentViewerProps } from "./types.ts";

const sessions = new Map<
	string,
	{ activePath: string | null; openFiles: FileContent[] }
>();

/** The keyed DocumentViewer owner fixes workspace/session/cwd for this lifetime. */
export function useDocumentSession(props: DocumentViewerProps) {
	const identity = untrack(() => ({
		workspaceId: props.workspaceId,
		sessionId: props.sessionId ?? props.cwd,
		cwd: props.cwd,
	}));
	const key = JSON.stringify(identity);
	const cached = sessions.get(key);
	const initialFile = untrack(() => props.initialFile);
	const [openFiles, setOpenFiles] = createSignal(
		cached?.openFiles ?? (initialFile ? [initialFile] : []),
	);
	const [activePath, setActivePath] = createSignal<string | null>(
		cached?.activePath ?? initialFile?.path ?? null,
	);
	const [restoring, setRestoring] = createSignal(!cached);
	const [error, setError] = createSignal<string | null>(null);
	const activeFile = createMemo(
		() => openFiles().find((file) => file.path === activePath()) ?? null,
	);
	const closed = new Set<string>();
	let selectionVersion = 0;
	let disposed = false;
	const requests = new Set<AbortController>();
	onCleanup(() => {
		disposed = true;
		selectionVersion++;
		for (const request of requests) request.abort();
	});
	createEffect(
		() => ({
			activePath: activePath(),
			openFiles: openFiles(),
			restoring: restoring(),
			notify: props.onSessionChange,
		}),
		({ activePath, openFiles, restoring, notify }) => {
			if (restoring) return;
			sessions.set(key, { activePath, openFiles });
			notify?.(identity.sessionId, {
				cwd: identity.cwd,
				activePath,
				paths: openFiles.map((file) => file.path),
			});
		},
	);
	onSettled(() => {
		if (cached) return;
		const controller = new AbortController();
		requests.add(controller);
		void postJson<{ files: FileContent[]; activePath: string | null }>(
			"/api/workspace/documents",
			{ ...identity, initialPath: initialFile?.path },
			{ signal: controller.signal },
		)
			.then((restored) => {
				if (disposed) return;
				const files = restored.files.filter((file) => !closed.has(file.path));
				setOpenFiles((current) => [
					...files.map(
						(file) => current.find((open) => open.path === file.path) ?? file,
					),
					...current.filter(
						(open) => !files.some((file) => file.path === open.path),
					),
				]);
				if (selectionVersion === 0)
					setActivePath(
						(current) =>
							current ??
							(closed.has(restored.activePath ?? "")
								? (files[0]?.path ?? null)
								: restored.activePath),
					);
				setRestoring(false);
			})
			.catch((cause) => {
				if (!disposed)
					setError(
						cause instanceof Error ? cause.message : "Files could not restore",
					);
			})
			.finally(() => requests.delete(controller));
	});
	const selectFile = (path: string) => {
		selectionVersion++;
		setActivePath(path);
	};
	const openFile = ({ path }: { path: string }) => {
		const version = ++selectionVersion;
		const controller = new AbortController();
		requests.add(controller);
		closed.delete(path);
		void fetchJson<FileContent>(
			`/api/files/content?${new URLSearchParams({ cwd: identity.cwd, path })}`,
			{ signal: controller.signal },
		)
			.then((file) => {
				if (disposed || closed.has(path)) return;
				setOpenFiles((current) =>
					current.some((open) => open.path === file.path)
						? current.map((open) => (open.path === file.path ? file : open))
						: [...current, file],
				);
				if (version === selectionVersion) {
					setActivePath(file.path);
					setError(null);
				}
			})
			.catch((cause) => {
				if (!disposed && version === selectionVersion)
					setError(
						cause instanceof Error ? cause.message : "File could not open",
					);
			})
			.finally(() => requests.delete(controller));
	};
	createEffect(
		() => (props.openRequest ? JSON.stringify(props.openRequest) : null),
		(request) => {
			if (request) openFile(JSON.parse(request));
		},
	);
	const closeFile = (path: string) => {
		closed.add(path);
		const current = openFiles();
		const index = current.findIndex((file) => file.path === path);
		const next = current.filter((file) => file.path !== path);
		setOpenFiles(next);
		if (activePath() === path) {
			selectionVersion++;
			setActivePath(next[Math.min(index, next.length - 1)]?.path ?? null);
		}
		return next.length;
	};
	const startFileTabDrag = (event: PointerEvent, file: FileContent) => {
		if (
			!props.onFileTabDragStart ||
			(event.target as HTMLElement).closest("button")
		)
			return;
		event.stopPropagation();
		props.onFileTabDragStart(event, file, () => {
			if (disposed) return;
			if (closeFile(file.path) === 0) props.onClose();
		});
	};
	return {
		error,
		openFiles,
		activePath,
		activeFile,
		openFile,
		selectFile,
		closeFile,
		startFileTabDrag,
	};
}
