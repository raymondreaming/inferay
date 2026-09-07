import * as stylex from "@stylexjs/stylex";
import type { FileContent } from "../../../../../../build/presentation/contracts/FileContent.ts";
import { iconSize } from "../../../../../design-system/styles.stylex.ts";
import {
	ariaValue,
	basename as fileName,
} from "../../../../../shared/lib/dom.tsx";
import { IconX } from "../../../../../shared/ui/Icons/index.tsx";
import { FileTypeIcon } from "../../../../explorer/components/FileTypeIcon/index.tsx";
import { styles } from "./styles.ts";
export function DocumentTab(_props: {
	activePath: string | null;
	onFileTabDragStart: boolean;
	startFileTabDrag: (event: PointerEvent, file: FileContent) => void;
	setActivePath: (path: string) => void;
	closeFile: (path: string) => void;
	file: FileContent;
}) {
	return (
		<div
			data-workspace-dock-drag-source={
				_props.onFileTabDragStart ? "true" : undefined
			}
			onPointerDown={(event) => _props.startFileTabDrag(event, _props.file)}
			{...stylex.attrs(
				styles.fileTab,
				_props.file.path === _props.activePath && styles.fileTabActive,
			)}
		>
			<button
				type="button"
				onPointerDown={(event) => {
					if (event.button === 0 && event.isPrimary)
						_props.setActivePath(_props.file.path);
				}}
				onClick={(event) => {
					if (event.detail === 0) _props.setActivePath(_props.file.path);
				}}
				{...stylex.attrs(styles.fileTabSelect)}
			>
				<FileTypeIcon path={_props.file.path} size={iconSize._2md} />
				<span {...stylex.attrs(styles.fileTabName)}>
					{fileName(_props.file.path)}
				</span>
			</button>
			<button
				type="button"
				aria-label={ariaValue(`Close ${fileName(_props.file.path)}`)}
				onPointerDown={(event) => {
					event.stopPropagation();
					if (event.button === 0 && event.isPrimary)
						_props.closeFile(_props.file.path);
				}}
				onClick={(event) => {
					event.stopPropagation();
					if (event.detail === 0) _props.closeFile(_props.file.path);
				}}
				{...stylex.attrs(styles.fileTabClose)}
			>
				<IconX size={iconSize.xs} />
			</button>
		</div>
	);
}
