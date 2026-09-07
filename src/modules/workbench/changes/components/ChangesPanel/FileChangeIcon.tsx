import * as stylex from "@stylexjs/stylex";
import { iconSize } from "../../../../../design-system/styles.stylex.ts";
import { FileTypeIcon } from "../../../../explorer/components/FileTypeIcon/index.tsx";
import { FileStatusIcon } from "./FileStatusIcon.tsx";
import { styles } from "./styles.ts";
export function FileChangeIcon(_props: {
	file: {
		readonly path: string;
		readonly status: string;
	};
}) {
	return (
		<span {...stylex.attrs(styles.fileChangeIcon)}>
			<FileTypeIcon path={_props.file.path} size={iconSize._2lg} />
			<span {...stylex.attrs(styles.fileChangeMark)}>
				<FileStatusIcon status={_props.file.status} />
			</span>
		</span>
	);
}
