import * as stylex from "@stylexjs/stylex";
import type { HunkDiff } from "../../../../../../build/presentation/contracts/HunkDiff.ts";
import { diffStyles } from "./styles.ts";
export function BinaryPreview(_props: {
	diff: Pick<HunkDiff, "isImage" | "imagePath">;
	filePath: string;
}) {
	return (
		<div {...stylex.attrs(diffStyles.imageBody)}>
			{_props.diff.isImage && _props.diff.imagePath ? (
				<img
					src={`/api/file?path=${encodeURIComponent(_props.diff.imagePath)}`}
					alt={_props.filePath}
					{...stylex.attrs(diffStyles.image)}
				/>
			) : (
				<span {...stylex.attrs(diffStyles.centerText)}>Binary file</span>
			)}
		</div>
	);
}
