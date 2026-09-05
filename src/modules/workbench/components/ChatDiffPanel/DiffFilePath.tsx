import * as stylex from "@octanejs/stylex";

import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { FileTypeIcon } from "../../../explorer/components/FileTypeIcon/index.tsx";

import { styles } from "./styles.ts";

export function DiffFilePath({ path }: { readonly path: string }) {
	const separator = path.lastIndexOf("/");
	const fileName = separator >= 0 ? path.slice(separator + 1) : path;
	return (
		<span title={path} {...stylex.props(styles.viewerFloatingFile)}>
			<FileTypeIcon path={path} size={iconSize.md} />
			<span {...stylex.props(styles.viewerFloatingPath)}>
				<strong {...stylex.props(styles.viewerFileName)}>{fileName}</strong>
			</span>
		</span>
	);
}
