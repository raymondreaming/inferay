import * as stylex from "@stylexjs/stylex";
import { createMemo, Show } from "solid-js";
import { APP_REGION_DRAG_CLASS } from "../../../../../app/hooks/useAppAppearance.tsx";
import { iconSize } from "../../../../../design-system/styles.stylex.ts";
import { ErrorBoundary } from "../../../../../shared/ui/ErrorBoundary/index.tsx";
import { IconCode, IconX } from "../../../../../shared/ui/Icons/index.tsx";
import { FileSearch } from "../../../../explorer/components/FileSearch/index.tsx";
import { WorkspaceDockHandle } from "../../../components/WorkspaceDockHandle/index.tsx";
import { DocumentTabs } from "./DocumentTabs.tsx";
import { SourcePreview } from "./SourcePreview.tsx";
import { styles } from "./styles.ts";
import type { DocumentViewerProps } from "./types.ts";
import { useDocumentSession } from "./useDocumentSession.ts";

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
