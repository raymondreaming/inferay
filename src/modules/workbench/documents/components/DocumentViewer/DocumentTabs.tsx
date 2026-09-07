import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import type { FileContent } from "../../../../../../build/presentation/contracts/FileContent.ts";
import { APP_REGION_NO_DRAG_CLASS } from "../../../../../app/hooks/useAppAppearance.tsx";
import { DocumentTab } from "./DocumentTab.tsx";
import { styles } from "./styles.ts";
export function DocumentTabs(_props: {
	activePath: string | null;
	onFileTabDragStart: boolean;
	startFileTabDrag: (event: PointerEvent, file: FileContent) => void;
	setActivePath: (path: string) => void;
	closeFile: (path: string) => void;
	openFiles: FileContent[];
}) {
	return (
		<div
			{...stylex.attrs(styles.fileTabs)}
			class={`${APP_REGION_NO_DRAG_CLASS} ${stylex.attrs(styles.fileTabs).class ?? ""}`}
		>
			{_props.openFiles.length > 0 ? (
				<For each={_props.openFiles} keyed={(row) => row.path}>
					{(file) => (
						<DocumentTab
							activePath={_props.activePath}
							onFileTabDragStart={Boolean(_props.onFileTabDragStart)}
							startFileTabDrag={_props.startFileTabDrag}
							setActivePath={_props.setActivePath}
							closeFile={_props.closeFile}
							file={file()}
						/>
					)}
				</For>
			) : null}
		</div>
	);
}
