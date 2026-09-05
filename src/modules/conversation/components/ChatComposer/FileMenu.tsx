import * as stylex from "@octanejs/stylex";
import { FileMenuRow } from "./FileMenuRow.tsx";

import { styles } from "./styles.ts";
import type { useChatComposerState } from "./useChatComposerState.tsx";

type FileMenuProps = Pick<
	ReturnType<typeof useChatComposerState>,
	"fileMenu" | "fileResults" | "selectFile" | "setFileMenu"
>;
export function FileMenu({
	fileMenu,
	fileResults,
	selectFile,
	setFileMenu,
}: FileMenuProps) {
	return (
		<div {...stylex.props(styles.floatingMenu, styles.fileMenu)}>
			<div {...stylex.props(styles.menuHeader)}>
				FILES
				{fileMenu.query ? ` matching "${fileMenu.query}"` : ""}
			</div>
			{fileResults.map((file, idx) => (
				<FileMenuRow
					key={file.path}
					file={file}
					index={idx}
					selected={idx === fileMenu.selectedIdx}
					selectFile={selectFile}
					setFileMenu={setFileMenu}
				/>
			))}
		</div>
	);
}
