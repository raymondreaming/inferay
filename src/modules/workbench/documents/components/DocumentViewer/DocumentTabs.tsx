import * as stylex from "@octanejs/stylex";
import type { FileContent } from "../../../../../../build/presentation/contracts/FileContent.ts";
import { APP_REGION_NO_DRAG_CLASS } from "../../../../../app/hooks/useAppAppearance.tsx";
import { DocumentTab } from "./DocumentTab.tsx";
import { styles } from "./styles.ts";

export function DocumentTabs({
	activePath,
	onFileTabDragStart,
	startFileTabDrag,
	setActivePath,
	closeFile,
	openFiles,
}: {
	activePath: string | null;
	onFileTabDragStart: boolean;
	startFileTabDrag: (event: PointerEvent, file: FileContent) => void;
	setActivePath: (path: string) => void;
	closeFile: (path: string) => void;
	openFiles: FileContent[];
}) {
	return (
		<div
			{...stylex.props(styles.fileTabs)}
			className={`${APP_REGION_NO_DRAG_CLASS} ${stylex.props(styles.fileTabs).className ?? ""}`}
		>
			{openFiles.length > 0
				? openFiles.map((file) => (
						<DocumentTab
							key={file.path}
							activePath={activePath}
							onFileTabDragStart={Boolean(onFileTabDragStart)}
							startFileTabDrag={startFileTabDrag}
							setActivePath={setActivePath}
							closeFile={closeFile}
							file={file}
						/>
					))
				: null}
		</div>
	);
}
