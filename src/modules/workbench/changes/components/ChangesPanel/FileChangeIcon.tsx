import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../../../design-system/styles.stylex.ts";
import { FileTypeIcon } from "../../../../explorer/components/FileTypeIcon/index.tsx";
import { FileStatusIcon } from "./FileStatusIcon.tsx";
import { styles } from "./styles.ts";

export function FileChangeIcon({
	file,
}: {
	file: { readonly path: string; readonly status: string };
}) {
	return (
		<span {...stylex.props(styles.fileChangeIcon)}>
			<FileTypeIcon path={file.path} size={iconSize._2lg} />
			<span {...stylex.props(styles.fileChangeMark)}>
				<FileStatusIcon status={file.status} />
			</span>
		</span>
	);
}
