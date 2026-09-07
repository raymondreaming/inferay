import * as stylex from "@stylexjs/stylex";
import type { Dispatch, StateUpdate } from "../../../../shared/lib/dom.tsx";
import type {
	FileMenuState,
	FileSearchResult,
} from "../../hooks/useAgentChatMenus.tsx";
import { styles } from "./styles.ts";
export const FileMenuRow = function FileMenuRow(_props: {
	file: FileSearchResult;
	index: number;
	selected: boolean;
	selectFile: (idx: number) => void;
	setFileMenu: Dispatch<StateUpdate<FileMenuState>>;
}) {
	return (
		<button
			type="button"
			onClick={() => _props.selectFile(_props.index)}
			onMouseEnter={() =>
				_props.setFileMenu((prev) =>
					prev.selectedIdx === _props.index
						? prev
						: {
								...prev,
								selectedIdx: _props.index,
							},
				)
			}
			{...stylex.attrs(
				styles.fileMenuRow,
				_props.selected && styles.fileMenuRowActive,
			)}
		>
			<span {...stylex.attrs(styles.fileMenuIcon)}>
				{_props.file.isDir ? "\u{1F4C1}" : "\u{1F4C4}"}
			</span>
			<span {...stylex.attrs(styles.fileMenuName)}>{_props.file.name}</span>
			<span {...stylex.attrs(styles.fileMenuPath)}>{_props.file.path}</span>
		</button>
	);
};
