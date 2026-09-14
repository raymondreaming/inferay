import type { DocumentView, FileContent } from "@contracts";
import {
	loadFileContent,
	restoreDocumentSession,
} from "@repository/services/gitApi.ts";
import { DocumentReplica } from "@shared/lib/native.tsx";
import {
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onSettled,
	untrack,
} from "solid-js";
import type { DocumentViewerProps } from "./types.ts";

const sessions = new Map<
	string,
	{ activePath: string | null; openFiles: FileContent[] }
>();

/** The keyed owner fixes workspace/session/cwd. Native state contains paths, never file bodies. */
export function useDocumentSession(props: DocumentViewerProps) {
	const identity = untrack(() => ({
		workspaceId: props.workspaceId,
		sessionId: props.sessionId ?? props.cwd,
		cwd: props.cwd,
	}));
	const key = JSON.stringify(identity);
	const cached = sessions.get(key);
	const initialFile = untrack(() => props.initialFile);
	const files = new Map(
		(cached?.openFiles ?? (initialFile ? [initialFile] : [])).map((file) => [
			file.path,
			file,
		]),
	);
	const model = new DocumentReplica(
		JSON.stringify([...files.keys()]),
		cached?.activePath ?? initialFile?.path,
		!cached,
	);
	const [view, setView] = createSignal<DocumentView>(
		JSON.parse(model.snapshot()),
	);
	const openFiles = createMemo(() =>
		view().paths.map((path) => files.get(path)!),
	);
	const controller = new AbortController();
	const publish = () => setView(JSON.parse(model.snapshot()));
	onCleanup(() => {
		controller.abort();
		model.free();
	});
	createEffect(
		() => ({ view: view(), files: openFiles(), notify: props.onSessionChange }),
		({ view, files, notify }) => {
			if (view.restoring) return;
			sessions.set(key, { activePath: view.activePath, openFiles: files });
			notify?.(identity.sessionId, {
				cwd: identity.cwd,
				activePath: view.activePath,
				paths: view.paths,
			});
		},
	);
	const fail = (cause: unknown, fallback: string, version?: number) => {
		if (controller.signal.aborted) return;
		model.fail(version, cause instanceof Error ? cause.message : fallback);
		publish();
	};
	onSettled(() => {
		if (cached) return;
		void (async () => {
			try {
				const restored = await restoreDocumentSession(
					{ ...identity, initialPath: initialFile?.path },
					controller.signal,
				);
				if (controller.signal.aborted) return;
				model.restore(
					JSON.stringify(restored.files.map((file) => file.path)),
					restored.activePath ?? undefined,
				);
				for (const file of restored.files)
					if (!files.has(file.path)) files.set(file.path, file);
				publish();
			} catch (cause) {
				fail(cause, "Files could not restore");
			}
		})();
	});
	const openFile = async ({ path }: { path: string }) => {
		const version = model.open(path);
		try {
			const file = await loadFileContent(identity.cwd, path, controller.signal);
			if (controller.signal.aborted || !model.receive(version, path, file.path))
				return;
			files.set(file.path, file);
			publish();
		} catch (cause) {
			fail(cause, "File could not open", version);
		}
	};
	createEffect(
		() => (props.openRequest ? JSON.stringify(props.openRequest) : null),
		(request) => {
			if (request) void openFile(JSON.parse(request));
		},
	);
	const closeFile = (path: string) => {
		const remaining = model.close(path);
		files.delete(path);
		publish();
		return remaining;
	};
	return {
		error: () => view().error,
		openFiles,
		activePath: () => view().activePath,
		activeFile: createMemo(() => files.get(view().activePath ?? "") ?? null),
		openFile,
		selectFile: (path: string) => {
			model.select(path);
			publish();
		},
		closeFile,
		startFileTabDrag: (event: PointerEvent, file: FileContent) => {
			if (
				!props.onFileTabDragStart ||
				(event.target as HTMLElement).closest("button")
			)
				return;
			event.stopPropagation();
			props.onFileTabDragStart(event, file, () => {
				if (!controller.signal.aborted && closeFile(file.path) === 0)
					props.onClose();
			});
		},
	};
}
