import type { FileContent } from "@contracts";
import { iconSize } from "@design-system/styles.stylex.ts";
import { FileTypeIcon } from "@explorer/components/FileTypeIcon/index.tsx";
import { ariaValue, basename as fileName } from "@shared/lib/dom.tsx";
import { IconX } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { styles } from "./styles.ts";
export function DocumentTab(_props: {
	activePath: string | null;
	setActivePath: (path: string) => void;
	closeFile: (path: string) => void;
	file: FileContent;
}) {
	return (
		<div
			{...stylex.attrs(
				styles.fileTab,
				_props.file.path === _props.activePath && styles.fileTabActive,
			)}
		>
			<button
				type="button"
				onClick={() => _props.setActivePath(_props.file.path)}
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
				onClick={(event) => {
					event.stopPropagation();
					_props.closeFile(_props.file.path);
				}}
				{...stylex.attrs(styles.fileTabClose)}
			>
				<IconX size={iconSize.xs} />
			</button>
		</div>
	);
}
