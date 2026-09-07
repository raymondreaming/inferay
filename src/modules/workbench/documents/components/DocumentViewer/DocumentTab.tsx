import * as stylex from "@octanejs/stylex";
import type { FileContent } from "../../../../../../build/presentation/contracts/FileContent.ts";
import { iconSize } from "../../../../../design-system/styles.stylex.ts";
import { basename as fileName } from "../../../../../shared/lib/data.ts";
import { IconX } from "../../../../../shared/ui/Icons/index.tsx";
import { FileTypeIcon } from "../../../../explorer/components/FileTypeIcon/index.tsx";
import { styles } from "./styles.ts";

export function DocumentTab({
	activePath,
	onFileTabDragStart,
	startFileTabDrag,
	setActivePath,
	closeFile,
	file,
}: {
	activePath: string | null;
	onFileTabDragStart: boolean;
	startFileTabDrag: (event: PointerEvent, file: FileContent) => void;
	setActivePath: (path: string) => void;
	closeFile: (path: string) => void;
	file: FileContent;
}) {
	return (
		<div
			key={file.path}
			data-workspace-dock-drag-source={onFileTabDragStart ? "true" : undefined}
			onPointerDown={(event) => startFileTabDrag(event, file)}
			{...stylex.props(
				styles.fileTab,
				file.path === activePath && styles.fileTabActive,
			)}
		>
			<button
				type="button"
				onPointerDown={(event) => {
					if (event.button === 0 && event.isPrimary) setActivePath(file.path);
				}}
				onClick={(event) => {
					if (event.detail === 0) setActivePath(file.path);
				}}
				{...stylex.props(styles.fileTabSelect)}
			>
				<FileTypeIcon path={file.path} size={iconSize._2md} />
				<span {...stylex.props(styles.fileTabName)}>{fileName(file.path)}</span>
			</button>
			<button
				type="button"
				aria-label={`Close ${fileName(file.path)}`}
				onPointerDown={(event) => {
					event.stopPropagation();
					if (event.button === 0 && event.isPrimary) closeFile(file.path);
				}}
				onClick={(event) => {
					event.stopPropagation();
					if (event.detail === 0) closeFile(file.path);
				}}
				{...stylex.props(styles.fileTabClose)}
			>
				<IconX size={iconSize.xs} />
			</button>
		</div>
	);
}
