import { surfaceStyles } from "@design-system/styles.stylex.ts";
import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import type { useAgentChatMenus } from "../../hooks/useAgentChatMenus.tsx";
import { styles } from "./styles.ts";

export function FileMenu(
	_props: Pick<
		ReturnType<typeof useAgentChatMenus>,
		"fileMenu" | "fileResults" | "selectFile" | "setFileMenu"
	>,
) {
	return (
		<div
			{...stylex.attrs(
				surfaceStyles.overlay,
				styles.floatingMenu,
				styles.fileMenu,
			)}
		>
			<div {...stylex.attrs(styles.menuHeader)}>
				FILES
				{_props.fileMenu.query ? ` matching "${_props.fileMenu.query}"` : ""}
			</div>
			{
				<For each={_props.fileResults} keyed={(row) => row.path}>
					{(file, idx) => (
						<button
							type="button"
							onClick={() => _props.selectFile(idx())}
							onMouseEnter={() =>
								_props.setFileMenu((prev) =>
									prev.selectedIdx === idx()
										? prev
										: {
												...prev,
												selectedIdx: idx(),
											},
								)
							}
							{...stylex.attrs(
								styles.fileMenuRow,
								idx() === _props.fileMenu.selectedIdx &&
									styles.fileMenuRowActive,
							)}
						>
							<span {...stylex.attrs(styles.fileMenuIcon)}>
								{file().isDir ? "\u{1F4C1}" : "\u{1F4C4}"}
							</span>
							<span {...stylex.attrs(styles.fileMenuName)}>{file().name}</span>
							<span {...stylex.attrs(styles.fileMenuPath)}>{file().path}</span>
						</button>
					)}
				</For>
			}
		</div>
	);
}
