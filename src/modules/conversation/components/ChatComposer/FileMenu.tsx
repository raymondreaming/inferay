import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import { FileMenuRow } from "./FileMenuRow.tsx";
import { styles } from "./styles.ts";
import type { useChatComposerState } from "./useChatComposerState.tsx";

type FileMenuProps = Pick<
	ReturnType<typeof useChatComposerState>,
	"fileMenu" | "fileResults" | "selectFile" | "setFileMenu"
>;
export function FileMenu(_props: FileMenuProps) {
	return (
		<div {...stylex.attrs(styles.floatingMenu, styles.fileMenu)}>
			<div {...stylex.attrs(styles.menuHeader)}>
				FILES
				{_props.fileMenu.query ? ` matching "${_props.fileMenu.query}"` : ""}
			</div>
			{
				<For each={_props.fileResults} keyed={(row) => row.path}>
					{(file, idx) => (
						<FileMenuRow
							file={file()}
							index={idx()}
							selected={idx() === _props.fileMenu.selectedIdx}
							selectFile={_props.selectFile}
							setFileMenu={_props.setFileMenu}
						/>
					)}
				</For>
			}
		</div>
	);
}
