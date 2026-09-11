import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal } from "solid-js";
import type { DocumentSession } from "../../../../../../build/presentation/contracts/DocumentSession.ts";
import type { FileContent } from "../../../../../../build/presentation/contracts/FileContent.ts";
import { APP_REGION_DRAG_CLASS } from "../../../../../app/hooks/useAppAppearance.tsx";
import { iconSize } from "../../../../../design-system/styles.stylex.ts";
import { fetchJson, postJson } from "../../../../../shared/lib/native.tsx";
import { IconCode, IconX } from "../../../../../shared/ui/Icons/index.tsx";
import { FileSearch } from "../../../../explorer/components/FileSearch/index.tsx";
import { WorkspaceDockHandle } from "../../../components/WorkspaceDockHandle/index.tsx";
import { DocumentTabs } from "./DocumentTabs.tsx";
import { SourcePreview } from "./SourcePreview.tsx";
import { styles } from "./styles.ts";

const fileViewerSessions = new Map<
	string,
	{
		readonly activePath: string | null;
		readonly openFiles: FileContent[];
	}
>();
const readDocument = (cwd: string, path: string) =>
	fetchJson<FileContent>(
		`/api/files/content?${new URLSearchParams({
			cwd,
			path,
		})}`,
	);
export const DocumentViewer = function DocumentViewer(_props: {
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
}) {
	const [error, setError] = createSignal<string | null>(null);
	const cachedSession = createMemo(() =>
		fileViewerSessions.get(
			_props.sessionId === undefined ? _props.cwd : _props.sessionId,
		),
	);
	const [restoreRequest] = createSignal(
		(() =>
			cachedSession()
				? null
				: {
						workspaceId: _props.workspaceId,
						sessionId:
							_props.sessionId === undefined ? _props.cwd : _props.sessionId,
						cwd: _props.cwd,
						initialPath: _props.initialFile?.path,
					})(),
	);
	const closedPaths = {
		current: new Set<string>(),
	};
	const [openFiles, setOpenFiles] = createSignal<FileContent[]>(
		cachedSession()?.openFiles ??
			(_props.initialFile ? [_props.initialFile] : []),
	);
	const [activePath, setActivePath] = createSignal<string | null>(
		cachedSession()?.activePath ?? _props.initialFile?.path ?? null,
	);
	const [restoringSession, setRestoringSession] = createSignal(
		restoreRequest() !== null,
	);
	const activeFile = createMemo(
		() => openFiles().find((file) => file.path === activePath()) ?? null,
	);
	createEffect(
		() => [
			activePath(),
			_props.cwd,
			_props.onSessionChange,
			openFiles(),
			restoringSession(),
			_props.sessionId === undefined ? _props.cwd : _props.sessionId,
		],
		() => {
			const _activePathValue = activePath(),
				_openFilesValue = openFiles();
			if (restoringSession()) return;
			fileViewerSessions.set(
				_props.sessionId === undefined ? _props.cwd : _props.sessionId,
				{
					activePath: _activePathValue,
					openFiles: _openFilesValue,
				},
			);
			_props.onSessionChange?.(
				_props.sessionId === undefined ? _props.cwd : _props.sessionId,
				{
					cwd: _props.cwd,
					activePath: _activePathValue,
					paths: _openFilesValue.map((file) => file.path),
				},
			);
		},
	);
	createEffect(
		() => [restoreRequest()],
		() => {
			const _restoreRequestValue = restoreRequest();
			if (!_restoreRequestValue) return;
			let cancelled = false;
			postJson<{
				files: FileContent[];
				activePath: string | null;
			}>("/api/workspace/documents", _restoreRequestValue)
				.then((restored) => {
					if (cancelled) return;
					// Keep tabs opened or closed while the snapshot was loading.
					const files = restored.files.filter(
						(file) => !closedPaths.current.has(file.path),
					);
					setOpenFiles((current) => [
						...files.map(
							(file) => current.find((open) => open.path === file.path) ?? file,
						),
						...current.filter(
							(open) => !files.some((file) => file.path === open.path),
						),
					]);
					setActivePath(
						(current) =>
							current ??
							(closedPaths.current.has(restored.activePath ?? "")
								? (files[0]?.path ?? null)
								: restored.activePath),
					);
					setRestoringSession(false);
				})
				.catch((error) => {
					if (!cancelled)
						setError(
							error instanceof Error
								? error.message
								: "Files could not restore",
						);
				});
			return () => {
				cancelled = true;
			};
		},
	);
	const openFile = ({ path }: { path: string }) => {
		readDocument(_props.cwd, path)
			.then((file) => {
				closedPaths.current.delete(file.path);
				setOpenFiles((current) =>
					current.some((open) => open.path === file.path)
						? current.map((open) => (open.path === file.path ? file : open))
						: [...current, file],
				);
				setActivePath(file.path);
				setError(null);
			})
			.catch((nextError) => {
				setError(
					nextError instanceof Error
						? nextError.message
						: "File could not open",
				);
			});
	};
	const servedOpenRequest = {
		current: null as string | null,
	};
	createEffect(
		() => [openFile, _props.openRequest],
		() => {
			const request = _props.openRequest;
			if (!request) return;
			const key = `${request.token} ${request.path}`;
			if (servedOpenRequest.current === key) return;
			servedOpenRequest.current = key;
			openFile(request);
		},
	);
	const closeFile = (path: string) => {
		const _openFilesValue2 = openFiles();
		closedPaths.current.add(path);
		const index = _openFilesValue2.findIndex((file) => file.path === path);
		const next = _openFilesValue2.filter((file) => file.path !== path);
		setOpenFiles(next);
		if (activePath() === path) {
			setActivePath(next[Math.min(index, next.length - 1)]?.path ?? null);
		}
	};
	const startFileTabDrag = (event: PointerEvent, file: FileContent) => {
		if (!_props.onFileTabDragStart) return;
		if ((event.target as HTMLElement).closest("button")) return;
		event.stopPropagation();
		_props.onFileTabDragStart(event, file, () => {
			closeFile(file.path);
			if (openFiles().length === 1) _props.onClose();
		});
	};
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
					setActivePath={setActivePath}
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
				{activeFile() ? (
					<SourcePreview file={activeFile()!} />
				) : (
					<div {...stylex.attrs(styles.emptyState)}>
						<IconCode size={iconSize._2xl} />
						<span>Search above to open a file.</span>
					</div>
				)}
			</div>
			{error() ? <div {...stylex.attrs(styles.error)}>{error()}</div> : null}
		</section>
	);
};
