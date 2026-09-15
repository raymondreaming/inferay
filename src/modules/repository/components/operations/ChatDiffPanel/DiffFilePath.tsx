import { iconSize } from "@design-system/styles.stylex.ts";
import { FileTypeIcon } from "@explorer/components/FileTypeIcon/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import { styles } from "./styles.ts";
export function DiffFilePath(_props: { readonly path: string }) {
	const separator = createMemo(() => _props.path.lastIndexOf("/"));
	return (
		<span title={_props.path} {...stylex.attrs(styles.viewerFloatingFile)}>
			<FileTypeIcon path={_props.path} size={iconSize.md} />
			<span {...stylex.attrs(styles.viewerFloatingPath)}>
				<span {...stylex.attrs(styles.viewerDirectory)}>
					{separator() >= 0 ? _props.path.slice(0, separator()) : ""}
				</span>
				<strong {...stylex.attrs(styles.viewerFileName)}>
					{_props.path.slice(Math.max(0, separator()))}
				</strong>
			</span>
		</span>
	);
}
