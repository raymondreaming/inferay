import type { DocumentSession, DocumentView, FileContent } from "@contracts";
import { iconSize } from "@design-system/styles.stylex.ts";
import { FileSearch } from "@explorer/components/FileSearch/index.tsx";
import {
	loadFileContent,
	restoreDocumentSession,
} from "@repository/services/gitApi.ts";
import { APP_REGION_DRAG_CLASS } from "@shared/lib/dom.tsx";
import { DocumentReplica } from "@shared/lib/native.tsx";
import { ErrorBoundary } from "@shared/ui/ErrorBoundary/index.tsx";
import { IconCode, IconX } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { WorkspaceDockHandle } from "@workspace/components/WorkspaceDockHandle/index.tsx";
import {
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onSettled,
	Show,
	untrack,
} from "solid-js";
import { DocumentTabs } from "./DocumentTabs.tsx";
import { SourcePreview } from "./SourcePreview.tsx";
import { styles } from "./styles.ts";

export type DocumentViewerProps = {
	readonly cwd: string;
	readonly sessionId?: string;
	readonly initialFile?: FileContent;
	readonly onClose: () => void;
	readonly onFileTabDragStart?: (
		event: PointerEvent,
		file: FileContent,
		completeMove: () => void,
	) => void;
	readonly draggable?: boolean;
	readonly onDragStart?: (event: PointerEvent) => void;
	readonly onDragEnd?: () => void;
	readonly openRequest?: {
		readonly path: string;
		readonly token: number;
	} | null;
	readonly workspaceId: string;
	readonly onSessionChange?: (
		sessionId: string,
		session: DocumentSession,
	) => void;
};

const sessions = new Map<
	string,
	{ activePath: string | null; openFiles: FileContent[] }
>();

export function DocumentViewer(props: DocumentViewerProps) {
	const identity = createMemo(() =>
		JSON.stringify([
			props.workspaceId,
			props.sessionId ?? props.cwd,
			props.cwd,
		]),
	);
	return (
		<Show when={identity()} keyed>
			{(_identity) => <DocumentSessionView {...props} />}
		</Show>
	);
}

function DocumentSessionView(_props: DocumentViewerProps) {
	const {
		error,
		activePath,
		activeFile,
		openFiles,
		openFile,
		selectFile,
		closeFile,
		startFileTabDrag,
	} = useDocumentSession(_props);
	return (
		<section {...stylex.attrs(styles.root)}>
			<header
				{...stylex.attrs(styles.header)}
				class={`${APP_REGION_DRAG_CLASS} ${stylex.attrs(styles.header).class ?? ""}`}
			>
				<WorkspaceDockHandle
					draggable={_props.draggable}
					onDragStart={_props.onDragStart}
					onDragEnd={_props.onDragEnd}
				/>
				<DocumentTabs
					activePath={activePath()}
					onFileTabDragStart={Boolean(_props.onFileTabDragStart)}
					startFileTabDrag={startFileTabDrag}
					setActivePath={selectFile}
					closeFile={closeFile}
					openFiles={openFiles()}
				/>
				<FileSearch cwd={_props.cwd} onSelect={openFile} placement="panel" />
				<button
					type="button"
					onPointerDown={(event) => {
						if (event.button === 0 && event.isPrimary) _props.onClose();
					}}
					onClick={(event) => {
						if (event.detail === 0) _props.onClose();
					}}
					title="Close file viewer"
					aria-label="Close file viewer"
					{...stylex.attrs(styles.iconButton)}
				>
					<IconX size={iconSize.xs} />
				</button>
			</header>

			<div {...stylex.attrs(styles.body)}>
				<Show
					when={activeFile()?.path}
					keyed
					fallback={
						<div {...stylex.attrs(styles.emptyState)}>
							<IconCode size={iconSize._2xl} />
							<span>Search above to open a file.</span>
						</div>
					}
				>
					<ErrorBoundary label="Document preview" contained>
						<SourcePreview file={activeFile()!} />
					</ErrorBoundary>
				</Show>
			</div>
			{error() ? <div {...stylex.attrs(styles.error)}>{error()}</div> : null}
		</section>
	);
}

/** The keyed owner fixes workspace/session/cwd. Native state contains paths, never file bodies. */
function useDocumentSession(props: DocumentViewerProps) {
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
