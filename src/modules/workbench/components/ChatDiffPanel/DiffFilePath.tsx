import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { FileTypeIcon } from "../../../explorer/components/FileTypeIcon/index.tsx";
import { styles } from "./styles.ts";
export function DiffFilePath(_props: { readonly path: string }) {
	const separator = createMemo(() => _props.path.lastIndexOf("/"));
	const fileName = createMemo(() => {
		const _separatorValue = separator();
		return _separatorValue >= 0
			? _props.path.slice(_separatorValue + 1)
			: _props.path;
	});
	return (
		<span title={_props.path} {...stylex.attrs(styles.viewerFloatingFile)}>
			<FileTypeIcon path={_props.path} size={iconSize.md} />
			<span {...stylex.attrs(styles.viewerFloatingPath)}>
				<strong {...stylex.attrs(styles.viewerFileName)}>{fileName()}</strong>
			</span>
		</span>
	);
}
