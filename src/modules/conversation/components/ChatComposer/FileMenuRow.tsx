import * as stylex from "@octanejs/stylex";
import { memo } from "octane";
import type React from "react";
import type {
	FileMenuState,
	FileSearchResult,
} from "../../hooks/useAgentChatMenus.tsx";
import { styles } from "./styles.ts";

export const FileMenuRow = memo(function FileMenuRow({
	file,
	index,
	selected,
	selectFile,
	setFileMenu,
}: {
	file: FileSearchResult;
	index: number;
	selected: boolean;
	selectFile: (idx: number) => void;
	setFileMenu: React.Dispatch<React.SetStateAction<FileMenuState>>;
}) {
	return (
		<button
			type="button"
			onClick={() => selectFile(index)}
			onMouseEnter={() =>
				setFileMenu((prev) =>
					prev.selectedIdx === index ? prev : { ...prev, selectedIdx: index },
				)
			}
			{...stylex.props(
				styles.fileMenuRow,
				selected && styles.fileMenuRowActive,
			)}
		>
			<span {...stylex.props(styles.fileMenuIcon)}>
				{file.isDir ? "\u{1F4C1}" : "\u{1F4C4}"}
			</span>
			<span {...stylex.props(styles.fileMenuName)}>{file.name}</span>
			<span {...stylex.props(styles.fileMenuPath)}>{file.path}</span>
		</button>
	);
});
